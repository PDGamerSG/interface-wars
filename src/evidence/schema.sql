PRAGMA foreign_keys = ON;

CREATE TABLE metadata (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE trials (
  trial_id TEXT PRIMARY KEY,
  source_file TEXT NOT NULL,
  source_sha256 TEXT NOT NULL,
  trial_index INTEGER NOT NULL,
  arm TEXT NOT NULL,
  template TEXT NOT NULL,
  family TEXT NOT NULL,
  held_out INTEGER NOT NULL,
  correct INTEGER NOT NULL,
  outcome TEXT NOT NULL,
  final_text TEXT NOT NULL,
  cost_usd REAL NOT NULL,
  tool_calls INTEGER NOT NULL,
  tool_errors INTEGER NOT NULL,
  turns INTEGER NOT NULL,
  ms INTEGER NOT NULL,
  started_at TEXT NOT NULL
);

CREATE TABLE turns (
  trial_id TEXT NOT NULL REFERENCES trials(trial_id),
  turn_index INTEGER NOT NULL,
  text TEXT NOT NULL,
  usage_json TEXT NOT NULL,
  cost_usd REAL NOT NULL,
  stop_reason TEXT,
  source_pointer TEXT NOT NULL,
  PRIMARY KEY (trial_id, turn_index)
);

CREATE TABLE calls (
  trial_id TEXT NOT NULL,
  turn_index INTEGER NOT NULL,
  call_index INTEGER NOT NULL,
  name TEXT NOT NULL,
  input_json TEXT NOT NULL,
  output TEXT NOT NULL,
  is_error INTEGER NOT NULL,
  ms INTEGER NOT NULL,
  source_pointer TEXT NOT NULL,
  PRIMARY KEY (trial_id, turn_index, call_index),
  FOREIGN KEY (trial_id, turn_index) REFERENCES turns(trial_id, turn_index)
);

CREATE TABLE changes (
  trial_id TEXT NOT NULL REFERENCES trials(trial_id),
  change_index INTEGER NOT NULL,
  path TEXT NOT NULL,
  before_json TEXT NOT NULL,
  after_json TEXT NOT NULL,
  source_pointer TEXT NOT NULL,
  PRIMARY KEY (trial_id, change_index)
);

CREATE TABLE reasons (
  trial_id TEXT NOT NULL REFERENCES trials(trial_id),
  reason_index INTEGER NOT NULL,
  reason TEXT NOT NULL,
  source_pointer TEXT NOT NULL,
  PRIMARY KEY (trial_id, reason_index)
);

CREATE INDEX calls_name_idx ON calls(name);
CREATE INDEX calls_error_idx ON calls(is_error);
CREATE INDEX trials_template_arm_idx ON trials(template, arm);
CREATE INDEX trials_correct_idx ON trials(correct);
