CREATE TABLE IF NOT EXISTS proposals (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  prepared_for TEXT NOT NULL,
  intro_text TEXT,
  logo_data_url TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS proposal_items (
  id TEXT PRIMARY KEY,
  proposal_id TEXT NOT NULL,
  style_number TEXT NOT NULL,
  jewelry_category TEXT,
  description TEXT,
  metal TEXT,
  diamond_quality TEXT,
  total_carat_weight TEXT,
  stone_type TEXT,
  diamond_type TEXT NOT NULL,
  price TEXT,
  price_number REAL,
  notes TEXT,
  secondary_category TEXT,
  image_data_url TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  FOREIGN KEY (proposal_id) REFERENCES proposals(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS submissions (
  id TEXT PRIMARY KEY,
  proposal_id TEXT NOT NULL,
  customer_name TEXT,
  customer_email TEXT,
  customer_notes TEXT,
  status TEXT NOT NULL DEFAULT 'New',
  created_at TEXT NOT NULL,
  FOREIGN KEY (proposal_id) REFERENCES proposals(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS submission_items (
  id TEXT PRIMARY KEY,
  submission_id TEXT NOT NULL,
  proposal_item_id TEXT NOT NULL,
  style_number TEXT NOT NULL,
  diamond_type TEXT NOT NULL,
  quantity INTEGER NOT NULL,
  item_notes TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (submission_id) REFERENCES submissions(id) ON DELETE CASCADE,
  FOREIGN KEY (proposal_item_id) REFERENCES proposal_items(id)
);

CREATE INDEX IF NOT EXISTS idx_proposal_items_proposal ON proposal_items(proposal_id);
CREATE INDEX IF NOT EXISTS idx_proposals_slug ON proposals(slug);
CREATE INDEX IF NOT EXISTS idx_submissions_proposal ON submissions(proposal_id);
CREATE INDEX IF NOT EXISTS idx_submission_items_submission ON submission_items(submission_id);
