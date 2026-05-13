const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' }
  });

const now = () => new Date().toISOString();
const uid = () => crypto.randomUUID();

function isAuthed(request, env) {
  const configured = env.ADMIN_PASSWORD || '';
  if (!configured) return false;
  const auth = request.headers.get('authorization') || '';
  return auth === `Bearer ${configured}`;
}

async function readJson(request) {
  try { return await request.json(); } catch { return {}; }
}

function normalizePath(pathname) {
  return pathname.replace(/^\/api/, '').replace(/\/+$/, '') || '/';
}

function parsePriceNumber(value) {
  if (typeof value === 'number') return value;
  if (!value) return null;
  const n = Number(String(value).replace(/[^0-9.-]/g, ''));
  return Number.isFinite(n) ? n : null;
}

async function getProposalBySlug(env, slug) {
  const proposal = await env.DB.prepare('SELECT * FROM proposals WHERE slug = ?').bind(slug).first();
  if (!proposal) return null;
  const items = await env.DB.prepare('SELECT * FROM proposal_items WHERE proposal_id = ? ORDER BY sort_order ASC, style_number ASC')
    .bind(proposal.id).all();
  return { ...proposal, items: items.results || [] };
}

async function getProposalById(env, id) {
  const proposal = await env.DB.prepare('SELECT * FROM proposals WHERE id = ?').bind(id).first();
  if (!proposal) return null;
  const items = await env.DB.prepare('SELECT * FROM proposal_items WHERE proposal_id = ? ORDER BY sort_order ASC, style_number ASC')
    .bind(id).all();
  return { ...proposal, items: items.results || [] };
}

async function createProposal(request, env) {
  if (!isAuthed(request, env)) return json({ error: 'Unauthorized' }, 401);
  const body = await readJson(request);
  const slug = String(body.slug || '').trim().toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '');
  const preparedFor = String(body.prepared_for || '').trim();
  const items = Array.isArray(body.items) ? body.items : [];

  if (!slug) return json({ error: 'Missing slug' }, 400);
  if (!preparedFor) return json({ error: 'Missing Prepared For' }, 400);
  if (!items.length) return json({ error: 'No proposal items provided' }, 400);

  const existing = await env.DB.prepare('SELECT id FROM proposals WHERE slug = ?').bind(slug).first();
  if (existing?.id) {
    await env.DB.prepare('DELETE FROM submission_items WHERE submission_id IN (SELECT id FROM submissions WHERE proposal_id = ?)').bind(existing.id).run();
    await env.DB.prepare('DELETE FROM submissions WHERE proposal_id = ?').bind(existing.id).run();
    await env.DB.prepare('DELETE FROM proposal_items WHERE proposal_id = ?').bind(existing.id).run();
    await env.DB.prepare('DELETE FROM proposals WHERE id = ?').bind(existing.id).run();
  }

  const proposalId = uid();
  const timestamp = now();
  const statements = [
    env.DB.prepare(`INSERT INTO proposals (id, slug, prepared_for, intro_text, logo_data_url, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)`).bind(
      proposalId,
      slug,
      preparedFor,
      body.intro_text || null,
      body.logo_data_url || null,
      timestamp,
      timestamp
    )
  ];

  items.forEach((item, index) => {
    const diamondType = String(item.diamond_type || '').trim();
    statements.push(env.DB.prepare(`INSERT INTO proposal_items (
      id, proposal_id, style_number, jewelry_category, description, metal, diamond_quality,
      total_carat_weight, stone_type, diamond_type, price, price_number, notes,
      secondary_category, image_data_url, sort_order, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(
        uid(), proposalId,
        String(item.style_number || '').trim(),
        item.jewelry_category || null,
        item.description || null,
        item.metal || null,
        item.diamond_quality || null,
        item.total_carat_weight || null,
        item.stone_type || null,
        diamondType,
        item.price || null,
        parsePriceNumber(item.price),
        item.notes || null,
        item.secondary_category || null,
        item.image_data_url || null,
        index,
        timestamp
      ));
  });

  await env.DB.batch(statements);
  return json({ ok: true, proposal_id: proposalId, slug, url: `/proposal/${slug}` });
}

async function listAdminProposals(request, env) {
  if (!isAuthed(request, env)) return json({ error: 'Unauthorized' }, 401);
  const proposals = await env.DB.prepare(`
    SELECT p.*, COUNT(i.id) AS item_count
    FROM proposals p
    LEFT JOIN proposal_items i ON i.proposal_id = p.id
    GROUP BY p.id
    ORDER BY p.created_at DESC
  `).all();
  return json({ proposals: proposals.results || [] });
}

async function listSubmissions(request, env) {
  if (!isAuthed(request, env)) return json({ error: 'Unauthorized' }, 401);
  const rows = await env.DB.prepare(`
    SELECT s.*, p.slug, p.prepared_for, COUNT(si.id) AS item_count
    FROM submissions s
    JOIN proposals p ON p.id = s.proposal_id
    LEFT JOIN submission_items si ON si.submission_id = s.id
    GROUP BY s.id
    ORDER BY s.created_at DESC
  `).all();
  return json({ submissions: rows.results || [] });
}

async function readSubmission(request, env, id) {
  if (!isAuthed(request, env)) return json({ error: 'Unauthorized' }, 401);
  const submission = await env.DB.prepare(`
    SELECT s.*, p.slug, p.prepared_for, p.intro_text, p.logo_data_url
    FROM submissions s JOIN proposals p ON p.id = s.proposal_id
    WHERE s.id = ?
  `).bind(id).first();
  if (!submission) return json({ error: 'Submission not found' }, 404);
  const rows = await env.DB.prepare(`
    SELECT si.quantity, si.item_notes, si.diamond_type AS selected_diamond_type,
      pi.*
    FROM submission_items si
    JOIN proposal_items pi ON pi.id = si.proposal_item_id
    WHERE si.submission_id = ?
    ORDER BY pi.sort_order ASC
  `).bind(id).all();
  return json({ submission, items: rows.results || [] });
}

async function updateSubmission(request, env, id) {
  if (!isAuthed(request, env)) return json({ error: 'Unauthorized' }, 401);
  const body = await readJson(request);
  const status = body.status || 'Reviewed';
  await env.DB.prepare('UPDATE submissions SET status = ? WHERE id = ?').bind(status, id).run();
  return json({ ok: true });
}

async function createSubmission(request, env) {
  const body = await readJson(request);
  const proposalId = String(body.proposal_id || '').trim();
  const selections = Array.isArray(body.selections) ? body.selections : [];
  if (!proposalId) return json({ error: 'Missing proposal id' }, 400);
  if (!selections.length) return json({ error: 'No items selected' }, 400);

  const proposal = await env.DB.prepare('SELECT id FROM proposals WHERE id = ?').bind(proposalId).first();
  if (!proposal) return json({ error: 'Proposal not found' }, 404);

  const ids = selections.map(s => String(s.proposal_item_id || '')).filter(Boolean);
  if (!ids.length) return json({ error: 'No valid selected items' }, 400);

  const placeholders = ids.map(() => '?').join(',');
  const itemRows = await env.DB.prepare(`SELECT id, style_number, diamond_type FROM proposal_items WHERE proposal_id = ? AND id IN (${placeholders})`)
    .bind(proposalId, ...ids).all();
  const itemMap = new Map((itemRows.results || []).map(r => [r.id, r]));

  const timestamp = now();
  const submissionId = uid();
  const statements = [
    env.DB.prepare(`INSERT INTO submissions (id, proposal_id, customer_name, customer_email, customer_notes, status, created_at)
      VALUES (?, ?, ?, ?, ?, 'New', ?)`).bind(
      submissionId,
      proposalId,
      body.customer_name || null,
      body.customer_email || null,
      body.customer_notes || null,
      timestamp
    )
  ];

  for (const sel of selections) {
    const item = itemMap.get(String(sel.proposal_item_id || ''));
    if (!item) continue;
    const qty = Math.max(1, parseInt(sel.quantity || 1, 10));
    statements.push(env.DB.prepare(`INSERT INTO submission_items
      (id, submission_id, proposal_item_id, style_number, diamond_type, quantity, item_notes, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(uid(), submissionId, item.id, item.style_number, item.diamond_type, qty, sel.item_notes || null, timestamp));
  }

  await env.DB.batch(statements);
  return json({ ok: true, submission_id: submissionId });
}

export async function onRequest(context) {
  const { request, env } = context;
  if (!env.DB) return json({ error: 'D1 database binding DB is missing. Add DB binding in Cloudflare Pages settings.' }, 500);
  const url = new URL(request.url);
  const path = normalizePath(url.pathname);
  const method = request.method.toUpperCase();

  try {
    if (method === 'POST' && path === '/admin/proposals') return createProposal(request, env);
    if (method === 'GET' && path === '/admin/proposals') return listAdminProposals(request, env);
    if (method === 'GET' && path.startsWith('/admin/proposals/')) {
      if (!isAuthed(request, env)) return json({ error: 'Unauthorized' }, 401);
      return json(await getProposalById(env, path.split('/').pop()));
    }
    if (method === 'GET' && path === '/admin/submissions') return listSubmissions(request, env);
    if (method === 'GET' && path.startsWith('/admin/submissions/')) return readSubmission(request, env, path.split('/').pop());
    if (method === 'PATCH' && path.startsWith('/admin/submissions/')) return updateSubmission(request, env, path.split('/').pop());
    if (method === 'GET' && path.startsWith('/proposals/')) {
      const slug = decodeURIComponent(path.split('/').pop());
      const proposal = await getProposalBySlug(env, slug);
      if (!proposal) return json({ error: 'Proposal not found' }, 404);
      return json(proposal);
    }
    if (method === 'POST' && path === '/submissions') return createSubmission(request, env);
    return json({ error: 'Not found', path }, 404);
  } catch (err) {
    return json({ error: err.message || 'Unexpected error' }, 500);
  }
}
