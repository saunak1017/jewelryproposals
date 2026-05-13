import React, { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import * as XLSX from 'xlsx';
import { jsPDF } from 'jspdf';
import './styles.css';

const REQUIRED_COLUMNS = [
  'Style Number', 'Jewelry Category', 'Description', 'Metal', 'Diamond Quality',
  'Total Carat Weight', 'Stone Type', 'Price', 'Notes', 'Secondary Navigation Category', 'Diamond Type'
];

const ALLOWED_IMAGE_EXTENSIONS = ['jpg', 'jpeg', 'png'];
const api = {
  async get(url, password) {
    const res = await fetch(url, { headers: password ? { Authorization: `Bearer ${password}` } : {} });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Request failed');
    return data;
  },
  async post(url, body, password) {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(password ? { Authorization: `Bearer ${password}` } : {}) },
      body: JSON.stringify(body)
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Request failed');
    return data;
  },
  async patch(url, body, password) {
    const res = await fetch(url, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', ...(password ? { Authorization: `Bearer ${password}` } : {}) },
      body: JSON.stringify(body)
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Request failed');
    return data;
  }
};

function normalizeSlug(value) {
  return String(value || '').trim().toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '');
}
function normalizeStyle(value) {
  return String(value || '').trim().toLowerCase().replace(/\.[a-z0-9]+$/i, '');
}
function formatMoney(value) {
  if (value == null || value === '') return '';
  const text = String(value).trim();
  if (text.startsWith('$')) return text;
  const n = Number(text.replace(/[^0-9.-]/g, ''));
  if (Number.isFinite(n)) return n.toLocaleString(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: 2 });
  return text;
}

function formatCaratWeight(value) {
  const text = String(value || '').trim();
  if (!text) return '';
  return /cts?/i.test(text) ? text : `${text} cts`;
}

function diamondClass(value) {
  const v = String(value || '').toLowerCase();
  if (v.includes('lab')) return 'lab';
  if (v.includes('natural')) return 'natural';
  return 'other';
}
function groupItems(items) {
  const map = new Map();
  for (const item of items || []) {
    const key = String(item.style_number || '').trim();
    if (!map.has(key)) map.set(key, { style_number: key, variants: [] });
    map.get(key).variants.push(item);
  }
  return [...map.values()].map(group => {
    const categories = [...new Set(group.variants.map(v => v.secondary_category).filter(Boolean))];
    const types = [...new Set(group.variants.map(v => diamondClass(v.diamond_type)))];
    return { ...group, categories, hasLab: types.includes('lab'), hasNatural: types.includes('natural') };
  });
}
function pickDisplayVariant(group) {
  return group.variants.find(v => diamondClass(v.diamond_type) === 'natural') || group.variants[0];
}
function getPriceLabel(group) {
  if (group.variants.length === 1) return formatMoney(group.variants[0].price);
  const lab = group.variants.find(v => diamondClass(v.diamond_type) === 'lab');
  const natural = group.variants.find(v => diamondClass(v.diamond_type) === 'natural');
  if (lab && natural) return `Nat ${formatMoney(natural.price)} · Lab ${formatMoney(lab.price)}`;
  return group.variants.map(v => `${v.diamond_type}: ${formatMoney(v.price)}`).join(' · ');
}
function acceptedImage(file) {
  const ext = file.name.split('.').pop()?.toLowerCase();
  return ALLOWED_IMAGE_EXTENSIONS.includes(ext);
}
function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}
function compressImage(file, maxSize = 900, quality = 0.72) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const ratio = Math.min(1, maxSize / Math.max(img.width, img.height));
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(img.width * ratio);
        canvas.height = Math.round(img.height * ratio);
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL('image/jpeg', quality));
      };
      img.onerror = reject;
      img.src = reader.result;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}
function route() {
  const path = window.location.pathname;
  if (path.startsWith('/proposal/')) return { page: 'proposal', slug: path.split('/')[2], detailStyle: path.split('/')[4] || null };
  if (path.startsWith('/admin')) return { page: 'admin' };
  return { page: 'home' };
}
function navigate(path) {
  window.history.pushState({}, '', path);
  window.dispatchEvent(new Event('popstate'));
}

function App() {
  const [r, setR] = useState(route());
  useEffect(() => {
    const onPop = () => setR(route());
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);
  if (r.page === 'proposal') return <CustomerProposal slug={r.slug} detailStyle={r.detailStyle} />;
  if (r.page === 'admin') return <AdminApp />;
  return <Landing />;
}

function Landing() {
  return <div className="centerPage">
    <div className="heroCard">
      <h1>Jewelry Proposal App</h1>
      <p>Create private proposal links from Excel files, collect customer selections, and export clean submission PDFs.</p>
      <button onClick={() => navigate('/admin')}>Go to Admin</button>
    </div>
  </div>;
}

function AdminApp() {
  const [password, setPassword] = useState(localStorage.getItem('adminPassword') || '');
  const [tempPassword, setTempPassword] = useState('');
  const [tab, setTab] = useState('upload');
  if (!password) return <div className="centerPage"><div className="loginBox">
    <h1>Admin Login</h1>
    <p>Enter the password you set as ADMIN_PASSWORD in Cloudflare.</p>
    <input type="password" value={tempPassword} onChange={e => setTempPassword(e.target.value)} placeholder="Admin password" />
    <button onClick={() => { localStorage.setItem('adminPassword', tempPassword); setPassword(tempPassword); }}>Login</button>
  </div></div>;
  return <div className="adminShell">
    <aside>
      <h2>Proposal Admin</h2>
      <button className={tab==='upload'?'active':''} onClick={() => setTab('upload')}>New Proposal</button>
      <button className={tab==='proposals'?'active':''} onClick={() => setTab('proposals')}>Proposals</button>
      <button className={tab==='submissions'?'active':''} onClick={() => setTab('submissions')}>Submissions</button>
      <button onClick={() => { localStorage.removeItem('adminPassword'); setPassword(''); }}>Logout</button>
    </aside>
    <main>
      {tab === 'upload' && <UploadProposal password={password} />}
      {tab === 'proposals' && <ProposalList password={password} />}
      {tab === 'submissions' && <Submissions password={password} />}
    </main>
  </div>;
}

function UploadProposal({ password }) {
  const [proposal, setProposal] = useState({ prepared_for: '', intro_text: '', slug: '', logo_data_url: '' });
  const [rows, setRows] = useState([]);
  const [imageMap, setImageMap] = useState({});
  const [errors, setErrors] = useState([]);
  const [message, setMessage] = useState('');
  const [publishing, setPublishing] = useState(false);

  async function handleExcel(file) {
    setErrors([]);
    const data = await file.arrayBuffer();
    const wb = XLSX.read(data, { type: 'array' });
    const ws = wb.Sheets[wb.SheetNames[0]];
    const parsed = XLSX.utils.sheet_to_json(ws, { defval: '' });
    const headers = parsed.length ? Object.keys(parsed[0]) : [];
    const missing = REQUIRED_COLUMNS.filter(c => !headers.includes(c));
    if (missing.length) setErrors([`Missing columns: ${missing.join(', ')}`]);
    const mapped = parsed.map((r, index) => ({
      local_id: `${Date.now()}-${index}`,
      style_number: String(r['Style Number'] || '').trim(),
      jewelry_category: String(r['Jewelry Category'] || '').trim(),
      description: String(r['Description'] || '').trim(),
      metal: String(r['Metal'] || '').trim(),
      diamond_quality: String(r['Diamond Quality'] || '').trim(),
      total_carat_weight: String(r['Total Carat Weight'] || '').trim(),
      stone_type: String(r['Stone Type'] || '').trim(),
      price: formatMoney(r['Price']),
      notes: String(r['Notes'] || '').trim(),
      secondary_category: String(r['Secondary Navigation Category'] || '').trim(),
      diamond_type: String(r['Diamond Type'] || '').trim(),
      image_data_url: ''
    })).filter(r => r.style_number);
    setRows(mapped);
  }

  async function handleImages(files) {
    const next = { ...imageMap };
    for (const file of files) {
      if (!acceptedImage(file)) continue;
      const key = normalizeStyle(file.name);
      next[key] = await compressImage(file);
    }
    setImageMap(next);
  }
  async function handleLogo(file) {
    if (!file) return;
    setProposal(p => ({ ...p, logo_data_url: '' }));
    setProposal(p => ({ ...p, logo_data_url: '' }));
    const dataUrl = acceptedImage(file) ? await compressImage(file, 500, 0.8) : '';
    setProposal(p => ({ ...p, logo_data_url: dataUrl }));
  }
  const mergedRows = useMemo(() => rows.map(r => ({ ...r, image_data_url: imageMap[normalizeStyle(r.style_number)] || r.image_data_url || '' })), [rows, imageMap]);
  const missingImages = mergedRows.filter(r => !r.image_data_url).length;
  const styleGroups = groupItems(mergedRows);
  const canPublish = proposal.prepared_for && proposal.slug && mergedRows.length && !errors.length;

  function updateRow(id, field, value) {
    setRows(rows.map(r => r.local_id === id ? { ...r, [field]: value } : r));
  }
  async function publish() {
    setPublishing(true); setMessage('');
    try {
      const payload = { ...proposal, slug: normalizeSlug(proposal.slug), items: mergedRows };
      const res = await api.post('/api/admin/proposals', payload, password);
      setMessage(`Published successfully: ${window.location.origin}${res.url}`);
    } catch (e) {
      setMessage(e.message);
    } finally { setPublishing(false); }
  }

  return <div>
    <h1>Create Proposal</h1>
    <div className="panel grid2">
      <label>Prepared For<input value={proposal.prepared_for} onChange={e => setProposal({ ...proposal, prepared_for: e.target.value })} placeholder="Riddles Jewelry" /></label>
      <label>Slug<input value={proposal.slug} onChange={e => setProposal({ ...proposal, slug: normalizeSlug(e.target.value) })} placeholder="riddles-may-2026" /></label>
      <label className="span2">Optional Intro Text<textarea value={proposal.intro_text} onChange={e => setProposal({ ...proposal, intro_text: e.target.value })} placeholder="Any free text to show under Prepared For" /></label>
      <label>Logo File<input type="file" accept=".jpg,.jpeg,.png,.JPG,.JPEG,.PNG" onChange={e => handleLogo(e.target.files[0])} /></label>
      <label>Excel File<input type="file" accept=".xlsx,.xls" onChange={e => handleExcel(e.target.files[0])} /></label>
      <label className="span2">Product Images<input type="file" accept=".jpg,.jpeg,.png,.JPG,.JPEG,.PNG" multiple onChange={e => handleImages([...e.target.files])} /></label>
    </div>
    {errors.map(e => <div className="alert" key={e}>{e}</div>)}
    {rows.length > 0 && <div className="summaryStrip">
      <span>{mergedRows.length} rows</span><span>{styleGroups.length} unique styles</span><span>{missingImages} missing images</span><span>{styleGroups.filter(g => g.hasLab && g.hasNatural).length} styles with both Natural + Lab</span>
    </div>}
    {rows.length > 0 && <div className="panel">
      <div className="rowBetween"><h2>Review Pulled Information</h2><button disabled={!canPublish || publishing} onClick={publish}>{publishing ? 'Publishing...' : 'Approve & Publish'}</button></div>
      {message && <div className="success">{message}</div>}
      <div className="reviewTableWrap"><table className="reviewTable"><thead><tr><th>Image</th>{['style_number','jewelry_category','description','metal','diamond_quality','total_carat_weight','stone_type','diamond_type','price','notes','secondary_category'].map(h => <th key={h}>{h.replaceAll('_',' ')}</th>)}</tr></thead><tbody>
        {mergedRows.map(row => <tr key={row.local_id}>
          <td>{row.image_data_url ? <img src={row.image_data_url} /> : <span className="missing">Missing</span>}</td>
          {['style_number','jewelry_category','description','metal','diamond_quality','total_carat_weight','stone_type','diamond_type','price','notes','secondary_category'].map(field => <td key={field}><input value={row[field] || ''} onChange={e => updateRow(row.local_id, field, e.target.value)} /></td>)}
        </tr>)}
      </tbody></table></div>
    </div>}
  </div>;
}

function ProposalList({ password }) {
  const [data, setData] = useState(null); const [error, setError] = useState('');
  useEffect(() => { api.get('/api/admin/proposals', password).then(setData).catch(e => setError(e.message)); }, []);
  if (error) return <div className="alert">{error}</div>;
  if (!data) return <p>Loading...</p>;
  return <div><h1>Published Proposals</h1><div className="cardsList">
    {data.proposals.map(p => <div className="panel listCard" key={p.id}>
      <div><h3>{p.prepared_for}</h3><p>{p.item_count} items · /proposal/{p.slug}</p></div>
      <button onClick={() => window.open(`/proposal/${p.slug}`, '_blank')}>Open</button>
    </div>)}
  </div></div>;
}

function Submissions({ password }) {
  const [list, setList] = useState(null); const [selected, setSelected] = useState(null); const [error, setError] = useState('');
  const load = () => api.get('/api/admin/submissions', password).then(setList).catch(e => setError(e.message));
  useEffect(load, []);
  async function open(id) { setSelected(await api.get(`/api/admin/submissions/${id}`, password)); }
  if (selected) return <SubmissionDetail data={selected} password={password} back={() => { setSelected(null); load(); }} />;
  if (error) return <div className="alert">{error}</div>;
  if (!list) return <p>Loading...</p>;
  return <div><h1>Submissions</h1><div className="cardsList">
    {list.submissions.map(s => <div className="panel listCard" key={s.id}>
      <div><h3>{s.prepared_for}</h3><p>{new Date(s.created_at).toLocaleString()} · {s.item_count} items · {s.status}</p>{s.customer_name && <p>{s.customer_name} {s.customer_email ? `· ${s.customer_email}` : ''}</p>}</div>
      <button onClick={() => open(s.id)}>View</button>
    </div>)}
  </div></div>;
}

function SubmissionDetail({ data, password, back }) {
  const { submission, items } = data;
  const total = items.reduce((sum, i) => sum + ((Number(i.price_number) || 0) * (Number(i.quantity) || 0)), 0);
  async function markReviewed() { await api.patch(`/api/admin/submissions/${submission.id}`, { status: 'Reviewed' }, password); back(); }
  async function exportPdf() {
    const doc = new jsPDF({ unit: 'pt', format: 'letter' });
    let y = 40;
    doc.setFontSize(18); doc.text(`Selection Summary: ${submission.prepared_for}`, 40, y); y += 22;
    doc.setFontSize(10); doc.text(`Submitted: ${new Date(submission.created_at).toLocaleString()}`, 40, y); y += 24;
    for (const item of items) {
      if (y > 650) { doc.addPage(); y = 40; }
      if (item.image_data_url) {
        try {
          const format = String(item.image_data_url).includes('data:image/png') ? 'PNG' : 'JPEG';
          doc.addImage(item.image_data_url, format, 40, y, 90, 90);
        } catch {}
      }
      doc.setFontSize(13); doc.text(String(item.style_number || ''), 145, y + 15);
      doc.setFontSize(9);
      const lines = [
        item.description, `Metal: ${item.metal || ''}`, `TCW: ${item.total_carat_weight || ''}`, `Stone Type: ${item.stone_type || ''}`,
        `Diamond Type: ${item.selected_diamond_type || item.diamond_type || ''}`, `Price: ${formatMoney(item.price)} · Qty: ${item.quantity}`
      ].filter(Boolean);
      lines.forEach((line, idx) => doc.text(String(line).slice(0, 95), 145, y + 32 + (idx * 12)));
      y += 110;
    }
    doc.setFontSize(12); doc.text(`Quoted Total: ${formatMoney(total)}`, 40, y + 10);
    doc.save(`${submission.prepared_for || 'selection'}-summary.pdf`);
  }
  return <div><button className="textButton" onClick={back}>← Back</button>
    <div className="rowBetween"><div><h1>{submission.prepared_for}</h1><p>{new Date(submission.created_at).toLocaleString()} · Status: {submission.status}</p></div><div className="buttonRow"><button onClick={exportPdf}>Export PDF</button><button onClick={markReviewed}>Mark Reviewed</button></div></div>
    <div className="panel"><h2>Customer Info</h2><p><b>Name:</b> {submission.customer_name || 'Not provided'}</p><p><b>Email:</b> {submission.customer_email || 'Not provided'}</p>{submission.customer_notes && <p><b>Notes:</b> {submission.customer_notes}</p>}</div>
    <div className="submissionGrid">{items.map(i => <div className="submissionItem" key={i.id}><img src={i.image_data_url || ''} /><div><h3>{i.style_number}</h3><p>{i.description}</p><p>{i.metal} · {formatCaratWeight(i.total_carat_weight)} · {i.stone_type}</p><p><b>{i.selected_diamond_type}</b> · Qty {i.quantity} · {formatMoney(i.price)}</p>{i.item_notes && <p>Note: {i.item_notes}</p>}</div></div>)}</div>
  </div>;
}

function CustomerProposal({ slug, detailStyle }) {
  const [proposal, setProposal] = useState(null); const [error, setError] = useState('');
  const [category, setCategory] = useState('All Styles'); const [selection, setSelection] = useState(() => JSON.parse(localStorage.getItem(`selection-${slug}`) || '{}'));
  const [showReview, setShowReview] = useState(false);
  useEffect(() => { api.get(`/api/proposals/${slug}`).then(setProposal).catch(e => setError(e.message)); }, [slug]);
  useEffect(() => { localStorage.setItem(`selection-${slug}`, JSON.stringify(selection)); }, [selection, slug]);
  if (error) return <div className="centerPage"><div className="heroCard"><h1>Proposal Not Found</h1><p>{error}</p></div></div>;
  if (!proposal) return <div className="centerPage"><p>Loading proposal...</p></div>;
  const groups = groupItems(proposal.items);
  const categories = ['All Styles', ...[...new Set(proposal.items.map(i => i.secondary_category).filter(Boolean))]];
  const filtered = category === 'All Styles' ? groups : groups.filter(g => g.categories.includes(category));
  const selectedCount = Object.keys(selection).length;
  const detailGroup = detailStyle ? groups.find(g => encodeURIComponent(g.style_number) === detailStyle || g.style_number === decodeURIComponent(detailStyle)) : null;
  if (showReview) return <ReviewSelection proposal={proposal} groups={groups} selection={selection} setSelection={setSelection} back={() => setShowReview(false)} />;
  if (detailGroup) return <ProductDetail proposal={proposal} group={detailGroup} selection={selection} setSelection={setSelection} back={() => navigate(`/proposal/${slug}`)} review={() => setShowReview(true)} />;
  return <div className="customerPage">
    <CustomerHeader proposal={proposal} selectedCount={selectedCount} review={() => setShowReview(true)} />
    <nav className="categoryNav">{categories.map(c => <button key={c} className={category===c?'active':''} onClick={() => setCategory(c)}>{c}</button>)}</nav>
    <div className="productGrid">{filtered.map(g => <ProductCard key={g.style_number} slug={slug} group={g} selected={!!selection[g.style_number]} toggle={() => setSelection(s => {
      const next = { ...s }; if (next[g.style_number]) delete next[g.style_number]; else next[g.style_number] = { style_number: g.style_number }; return next;
    })} />)}</div>
  </div>;
}
function CustomerHeader({ proposal, selectedCount, review }) {
  return <div className="headerShell">
    {proposal.logo_data_url && <img className="logo" src={proposal.logo_data_url} />}
    {proposal.logo_data_url && <p className="logoAddress">589 5th Ave, Suite 1107, New York, NY 10017 | 212-593-2750</p>}
    <header className="proposalHeader">
      <div><p className="eyebrow">Prepared For:</p><h1>{proposal.prepared_for}</h1>{proposal.intro_text && <p className="intro">{proposal.intro_text}</p>}</div>
      <button className="selectionButton" onClick={review}>Review Selection ({selectedCount})</button>
    </header>
  </div>;
}
function ProductCard({ group, slug, selected, toggle }) {
  const display = pickDisplayVariant(group);
  const availability = group.hasLab && group.hasNatural ? 'Natural + Lab' : group.hasLab ? 'Lab Grown' : 'Natural';
  const borderClass = group.hasLab && group.hasNatural ? 'both' : group.hasLab ? 'lab' : 'natural';
  return <div className={`productCard ${borderClass}`}>
    <button className="check" onClick={toggle}>{selected ? '✓ Selected' : '+ Select'}</button>
    <div onClick={() => navigate(`/proposal/${slug}/item/${encodeURIComponent(group.style_number)}`)} className="cardClick">
      <img src={display.image_data_url || ''} />
      <h2>{group.style_number}</h2>
      <p>{display.jewelry_category}</p><p>{display.metal} | {formatCaratWeight(display.total_carat_weight)}</p>
      <span className="badge">{availability}</span>
      <h3>{getPriceLabel(group)}</h3>
    </div>
  </div>;
}
function ProductDetail({ proposal, group, selection, setSelection, back, review }) {
  const display = pickDisplayVariant(group);
  return <div className="customerPage"><CustomerHeader proposal={proposal} selectedCount={Object.keys(selection).length} review={review} />
    <button className="textButton" onClick={back}>← Back to All Styles</button>
    <div className="detailLayout"><div><img className="detailImage" src={display.image_data_url || ''} /><button onClick={() => setSelection(s => ({ ...s, [group.style_number]: { style_number: group.style_number } }))}>Add to Selection</button></div>
      <div className="detailInfo"><h1>{group.style_number}</h1>{group.variants.length > 1 && <div className="compareBox"><h3>Available Options</h3><table><thead><tr><th>Diamond Type</th><th>Stone Type</th><th>Metal</th><th>TCW</th><th>Price</th></tr></thead><tbody>{group.variants.map(v => <tr key={v.id}><td>{v.diamond_type}</td><td>{v.stone_type}</td><td>{v.metal}</td><td>{formatCaratWeight(v.total_carat_weight)}</td><td>{formatMoney(v.price)}</td></tr>)}</tbody></table></div>}
      {group.variants.map(v => <div className="variantBlock" key={v.id}><h2>{v.diamond_type}</h2><Info label="Jewelry Category" value={v.jewelry_category}/><Info label="Description" value={v.description}/><Info label="Metal" value={v.metal}/><Info label="Diamond Quality" value={v.diamond_quality}/><Info label="Total Carat Weight" value={formatCaratWeight(v.total_carat_weight)}/><Info label="Stone Type" value={v.stone_type}/><Info label="Price" value={formatMoney(v.price)}/>{v.notes && <Info label="Notes" value={v.notes}/>}</div>)}</div></div>
  </div>;
}
function Info({ label, value }) { return value ? <p><b>{label}:</b> {value}</p> : null; }

function ReviewSelection({ proposal, groups, selection, setSelection, back }) {
  const selectedGroups = groups.filter(g => selection[g.style_number]);
  const [form, setForm] = useState({ customer_name: '', customer_email: '', customer_notes: '' });
  const [lines, setLines] = useState(() => selectedGroups.flatMap(g => {
    const lab = g.variants.filter(v => diamondClass(v.diamond_type) === 'lab');
    const natural = g.variants.filter(v => diamondClass(v.diamond_type) === 'natural');
    const defaultVariant = natural[0] || lab[0] || g.variants[0];
    return [{ key: `${g.style_number}-${defaultVariant.id}`, style_number: g.style_number, proposal_item_id: defaultVariant.id, quantity: 1, item_notes: '' }];
  }));
  const [message, setMessage] = useState('');
  function updateLine(idx, patch) { setLines(lines.map((l, i) => i === idx ? { ...l, ...patch } : l)); }
  function removeStyle(style) { const next = { ...selection }; delete next[style]; setSelection(next); setLines(lines.filter(l => l.style_number !== style)); }
  async function submit() {
    setMessage('');
    try {
      const payload = { proposal_id: proposal.id, ...form, selections: lines.filter(l => Number(l.quantity) > 0) };
      await api.post('/api/submissions', payload);
      localStorage.removeItem(`selection-${proposal.slug}`);
      setSelection({});
      setMessage('Selection submitted successfully. Thank you.');
    } catch (e) { setMessage(e.message); }
  }
  return <div className="customerPage"><CustomerHeader proposal={proposal} selectedCount={selectedGroups.length} review={() => {}} />
    <button className="textButton" onClick={back}>← Continue Reviewing</button><h1>Review Selection</h1>
    {!selectedGroups.length ? <div className="panel"><p>No styles selected yet.</p></div> : <div className="reviewSelectionLayout"><div>
      {selectedGroups.map((g, idx) => {
        const lineIndex = lines.findIndex(l => l.style_number === g.style_number);
        const line = lines[lineIndex];
        const selectedVariant = g.variants.find(v => v.id === line?.proposal_item_id) || g.variants[0];
        return <div className="selectionLine" key={g.style_number}><img src={(selectedVariant || pickDisplayVariant(g)).image_data_url || ''}/><div><h3>{g.style_number}</h3><p>{selectedVariant.description}</p><label>Option<select value={line?.proposal_item_id || ''} onChange={e => updateLine(lineIndex, { proposal_item_id: e.target.value })}>{g.variants.map(v => <option value={v.id} key={v.id}>{v.diamond_type} · {formatMoney(v.price)}</option>)}</select></label><label>Quantity<input type="number" min="1" value={line?.quantity || 1} onChange={e => updateLine(lineIndex, { quantity: e.target.value })}/></label><label>Notes<input value={line?.item_notes || ''} onChange={e => updateLine(lineIndex, { item_notes: e.target.value })}/></label><button className="textButton" onClick={() => removeStyle(g.style_number)}>Remove</button></div></div>;
      })}</div><div className="panel sticky"><h2>Submit Selection</h2><label>Your Name<input value={form.customer_name} onChange={e => setForm({ ...form, customer_name: e.target.value })}/></label><label>Email<input value={form.customer_email} onChange={e => setForm({ ...form, customer_email: e.target.value })}/></label><label>Notes<textarea value={form.customer_notes} onChange={e => setForm({ ...form, customer_notes: e.target.value })}/></label><button onClick={submit}>Submit Selection</button>{message && <div className="success">{message}</div>}</div></div>}
  </div>;
}

createRoot(document.getElementById('root')).render(<App />);
