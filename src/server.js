const express = require('express');
const Database = require('better-sqlite3');
const path = require('path');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;

// ── Database setup (SQLite — persistent on Railway volume) ──
const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', 'data', 'cimafondos.db');
const fs = require('fs');
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// ── Create tables ──
db.exec(`
  CREATE TABLE IF NOT EXISTS companies (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    cif TEXT,
    address TEXT,
    config TEXT DEFAULT '{}'
  );

  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    username TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    name TEXT NOT NULL,
    role TEXT DEFAULT 'user',
    company_id TEXT REFERENCES companies(id)
  );

  CREATE TABLE IF NOT EXISTS accounts (
    code TEXT NOT NULL,
    name TEXT NOT NULL,
    group_num INTEGER,
    type TEXT,
    company_id TEXT REFERENCES companies(id),
    PRIMARY KEY (code, company_id)
  );

  CREATE TABLE IF NOT EXISTS entries (
    id TEXT PRIMARY KEY,
    date TEXT NOT NULL,
    concept TEXT,
    type TEXT DEFAULT 'manual',
    company_id TEXT REFERENCES companies(id),
    created_by TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    deleted INTEGER DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS entry_lines (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    entry_id TEXT REFERENCES entries(id),
    account TEXT NOT NULL,
    debit REAL DEFAULT 0,
    credit REAL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS transactions (
    id TEXT PRIMARY KEY,
    date TEXT,
    amount REAL,
    description TEXT,
    matched INTEGER DEFAULT 0,
    matched_account TEXT,
    matched_rule TEXT,
    iva TEXT,
    paid_by TEXT,
    company_id TEXT REFERENCES companies(id),
    deleted INTEGER DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS rules (
    id TEXT PRIMARY KEY,
    pattern TEXT NOT NULL,
    account TEXT NOT NULL,
    description TEXT,
    priority INTEGER DEFAULT 1,
    iva TEXT DEFAULT 'na',
    company_id TEXT REFERENCES companies(id)
  );

  CREATE TABLE IF NOT EXISTS masters (
    id TEXT PRIMARY KEY,
    type TEXT NOT NULL,
    data TEXT NOT NULL,
    company_id TEXT REFERENCES companies(id)
  );

  CREATE TABLE IF NOT EXISTS images (
    id TEXT PRIMARY KEY,
    entry_id TEXT REFERENCES entries(id),
    data TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now'))
  );
`);

// ── Seed default data if empty ──
const companyCount = db.prepare('SELECT COUNT(*) as c FROM companies').get().c;
if (companyCount === 0) {
  db.prepare('INSERT INTO companies VALUES (?, ?, ?, ?, ?)').run(
    'c1', 'Cimafondos S.L.', 'B98000001', 'Valencia', '{}'
  );
  
  const users = [
    ['u1', 'admin', 'admin', 'Administrador', 'admin', 'c1'],
    ['u2', 'javier', '1234', 'Javier', 'admin', 'c1'],
    ['u3', 'pepe', '1234', 'Pepe', 'user', 'c1'],
    ['u4', 'santi', '1234', 'Santi', 'user', 'c1'],
  ];
  const insertUser = db.prepare('INSERT INTO users VALUES (?, ?, ?, ?, ?, ?)');
  users.forEach(u => insertUser.run(...u));

  // Default PGC accounts
  const pgc = [
    ['10000000','Capital social',1,'P'],['11200000','Reserva legal',1,'P'],
    ['12900000','Resultado del ejercicio',1,'P'],['17000000','Deudas LP ent. crédito',1,'P'],
    ['21100000','Construcciones',2,'A'],['21600000','Mobiliario',2,'A'],
    ['21700000','Equipos proceso información',2,'A'],['21800000','Elementos de transporte',2,'A'],
    ['25000000','Inversiones financieras LP',2,'A'],['28100000','Amort. acum. inmov. material',2,'A'],
    ['30000000','Mercaderías (NPL)',3,'A'],
    ['40000000','Proveedores',4,'P'],['41000000','Acreedores prest. servicios',4,'P'],
    ['43000000','Clientes',4,'A'],['44000000','Deudores',4,'A'],
    ['46500000','Remuneraciones ptes. pago',4,'P'],
    ['47200000','HP IVA soportado',4,'A'],['47300000','HP retenciones',4,'A'],
    ['47200001','HP Recargo equivalencia soportado',4,'A'],
    ['47500000','HP acreedora',4,'P'],['47700000','HP IVA repercutido',4,'P'],
    ['52000000','Deudas CP ent. crédito',5,'P'],['55100000','C/C con socios',5,'P'],
    ['55100001','C/C Pepe',5,'P'],['55100002','C/C Fernanda',5,'P'],
    ['55100003','C/C Sergio',5,'P'],['55100004','C/C Santi',5,'P'],
    ['55100005','C/C Salva',5,'P'],
    ['57000000','Caja',5,'A'],['57200000','Bancos c/c',5,'A'],
    ['60000000','Compras mercaderías',6,'G'],
    ['62100000','Arrendamientos',6,'G'],['62200000','Reparaciones',6,'G'],
    ['62300000','Servicios profesionales',6,'G'],['62400000','Transportes',6,'G'],
    ['62500000','Primas seguros',6,'G'],['62600000','Servicios bancarios',6,'G'],
    ['62700000','Publicidad y RRPP',6,'G'],['62800000','Suministros',6,'G'],
    ['62900000','Otros servicios',6,'G'],['63100000','Otros tributos',6,'G'],
    ['64000000','Sueldos y salarios',6,'G'],['64200000','Seg. Social empresa',6,'G'],
    ['66200000','Intereses deudas',6,'G'],['66900000','Otros gtos. financieros',6,'G'],
    ['68100000','Amortización inmov.',6,'G'],
    ['70000000','Ventas mercaderías',7,'I'],['70500000','Prestaciones servicios',7,'I'],
    ['75200000','Ingresos arrendamientos',7,'I'],['75900000','Ingresos serv. diversos',7,'I'],
    ['76200000','Ingresos de créditos',7,'I'],['76900000','Otros ing. financieros',7,'I'],
  ];
  const insertAcct = db.prepare('INSERT INTO accounts VALUES (?, ?, ?, ?, ?)');
  pgc.forEach(a => insertAcct.run(a[0], a[1], a[2], a[3], 'c1'));

  // Default rules
  const rules = [
    ['r1','ALQUILER|ARRENDAMIENTO|RENTA','62100000','Alquiler',1,'general'],
    ['r2','SEGURO|MAPFRE|ALLIANZ','62500000','Seguros',1,'exento'],
    ['r3','NOMINA|SALARIO|SUELDO','64000000','Nóminas',1,'na'],
    ['r4','SEGURIDAD SOCIAL|TGSS','64200000','Seg. Social',1,'na'],
    ['r5','COMISION|COMISIÓN','62600000','Comisiones banco',2,'exento'],
    ['r6','INTERES|INTERÉS','66200000','Intereses',2,'exento'],
    ['r7','ENDESA|IBERDROLA|NATURGY|LUZ','62800000','Suministros',1,'general'],
    ['r8','VODAFONE|MOVISTAR|ORANGE|TELEFON','62900000','Comunicaciones',1,'general'],
    ['r9','HACIENDA|AEAT|MODELO','47500000','Hacienda',1,'na'],
    ['r10','NOTARI|REGISTRO|ESCRITURA','62300000','Notaría/Registro',1,'general'],
    ['r11','ABOGADO|PROCURADOR|LETRADO','62300000','Abogado',1,'general'],
    ['r12','RESTAURANTE|COMIDA|CENA|ALMUERZO|BAR|CAFETERIA','62700000','Gtos. representación',1,'nodeducible'],
    ['r13','HOTEL|ALOJAMIENTO|HOSTAL|BOOKING','62900000','Viajes/Alojamiento',1,'nodeducible'],
    ['r14','TAXI|UBER|CABIFY|PARKING|GASOLINA|REPSOL|CEPSA','62400000','Transportes',1,'general'],
  ];
  const insertRule = db.prepare('INSERT INTO rules VALUES (?, ?, ?, ?, ?, ?, ?)');
  rules.forEach(r => insertRule.run(r[0], r[1], r[2], r[3], r[4], r[5], 'c1'));

  // Default masters (clients, suppliers, banks)
  const masters = [
    ['cl1', 'client', JSON.stringify({name:'Gusiluz Inversiones S.L.',cif:'B12345678',phone:'963000000',email:'info@gusiluz.es',contact:'Luis Martínez'}), 'c1'],
    ['su1', 'supplier', JSON.stringify({name:'Notaría Pérez Sanchis',cif:'12345678A',phone:'963111111',email:'notaria@perez.es',acct:'62300000'}), 'c1'],
    ['bk1', 'bank', JSON.stringify({name:'Santander',iban:'ES12 0049 XXXX XXXX',notes:'Cuenta principal',acct:'57200000'}), 'c1'],
    ['bk2', 'bank', JSON.stringify({name:'CaixaBank',iban:'ES34 2100 XXXX XXXX',notes:'Secundaria',acct:'57200001'}), 'c1'],
  ];
  const insertMaster = db.prepare('INSERT INTO masters VALUES (?, ?, ?, ?)');
  masters.forEach(m => insertMaster.run(...m));

  console.log('✓ Database seeded with default data');
}

// ── Middleware ──
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, '..', 'public')));

// ── AUTH ──
app.post('/api/login', (req, res) => {
  const { username, password } = req.body;
  const user = db.prepare('SELECT id, username, name, role, company_id FROM users WHERE username = ? AND password = ?').get(username, password);
  if (!user) return res.status(401).json({ error: 'Credenciales incorrectas' });
  const company = db.prepare('SELECT * FROM companies WHERE id = ?').get(user.company_id);
  res.json({ user, company });
});

// ── Helper: auto-create company if needed ──
function ensureCompany(companyId) {
  const existing = db.prepare('SELECT id FROM companies WHERE id = ?').get(companyId);
  if (!existing) {
    db.prepare('INSERT INTO companies VALUES (?, ?, ?, ?, ?)').run(companyId, companyId, '', '', '{}');
    // Copy default PGC accounts for new company
    const defaultAccounts = db.prepare('SELECT code, name, group_num, type FROM accounts WHERE company_id = ?').all('c1');
    const insertAcct = db.prepare('INSERT OR IGNORE INTO accounts VALUES (?, ?, ?, ?, ?)');
    defaultAccounts.forEach(a => insertAcct.run(a.code, a.name, a.group_num, a.type, companyId));
  }
}

// ── ACCOUNTS ──
app.get('/api/accounts/:companyId', (req, res) => {
  const rows = db.prepare('SELECT code, name, group_num as g, type as t FROM accounts WHERE company_id = ? ORDER BY code').all(req.params.companyId);
  res.json(rows);
});

app.post('/api/accounts/:companyId', (req, res) => {
  const { code, name, g, t } = req.body;
  ensureCompany(req.params.companyId);
  try {
    db.prepare('INSERT INTO accounts VALUES (?, ?, ?, ?, ?)').run(code, name, g, t, req.params.companyId);
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ── ENTRIES ──
app.get('/api/entries/:companyId', (req, res) => {
  const entries = db.prepare('SELECT * FROM entries WHERE company_id = ? ORDER BY date').all(req.params.companyId);
  const lines = db.prepare('SELECT * FROM entry_lines WHERE entry_id IN (SELECT id FROM entries WHERE company_id = ?)').all(req.params.companyId);
  const lineMap = {};
  lines.forEach(l => { if (!lineMap[l.entry_id]) lineMap[l.entry_id] = []; lineMap[l.entry_id].push({ a: l.account, d: l.debit, h: l.credit }); });
  const result = entries.map(e => ({ ...e, del: !!e.deleted, lines: lineMap[e.id] || [] }));
  res.json(result);
});

app.post('/api/entries/:companyId', (req, res) => {
  const { id, date, concept, type, lines } = req.body;
  const companyId = req.params.companyId;
  ensureCompany(companyId);

  const insertEntry = db.prepare('INSERT OR REPLACE INTO entries (id, date, concept, type, company_id, deleted) VALUES (?, ?, ?, ?, ?, 0)');
  const deleteLine = db.prepare('DELETE FROM entry_lines WHERE entry_id = ?');
  const insertLine = db.prepare('INSERT INTO entry_lines (entry_id, account, debit, credit) VALUES (?, ?, ?, ?)');
  
  const tx = db.transaction(() => {
    insertEntry.run(id, date, concept, type || 'manual', companyId);
    deleteLine.run(id);
    (lines || []).forEach(l => insertLine.run(id, l.a, l.d || 0, l.h || 0));
  });
  tx();
  res.json({ ok: true });
});

app.delete('/api/entries/:companyId/:id', (req, res) => {
  db.prepare('UPDATE entries SET deleted = 1 WHERE id = ? AND company_id = ?').run(req.params.id, req.params.companyId);
  res.json({ ok: true });
});

// Delete ALL entries for a company (or all companies)
app.delete('/api/entries-all/:companyId', (req, res) => {
  const cid = req.params.companyId;
  if (cid === '_all_') {
    const count = db.prepare('SELECT COUNT(*) as c FROM entries').get().c;
    db.prepare('DELETE FROM entry_lines').run();
    db.prepare('DELETE FROM entries').run();
    db.prepare('DELETE FROM transactions').run();
    res.json({ ok: true, deleted: count });
  } else {
    const count = db.prepare('SELECT COUNT(*) as c FROM entries WHERE company_id = ?').get(cid).c;
    db.prepare('DELETE FROM entry_lines WHERE entry_id IN (SELECT id FROM entries WHERE company_id = ?)').run(cid);
    db.prepare('DELETE FROM entries WHERE company_id = ?').run(cid);
    db.prepare('DELETE FROM transactions WHERE company_id = ?').run(cid);
    res.json({ ok: true, deleted: count });
  }
});

// Soft-delete: mark entries as deleted (recoverable)
app.post('/api/soft-delete-entries/:companyId', (req, res) => {
  const cid = req.params.companyId;
  let count;
  if (cid === '_all_') {
    count = db.prepare('SELECT COUNT(*) as c FROM entries WHERE deleted = 0').get().c;
    db.prepare('UPDATE entries SET deleted = 1 WHERE deleted = 0').run();
  } else {
    count = db.prepare('SELECT COUNT(*) as c FROM entries WHERE company_id = ? AND deleted = 0').get(cid).c;
    db.prepare('UPDATE entries SET deleted = 1 WHERE company_id = ? AND deleted = 0').run(cid);
  }
  res.json({ ok: true, count });
});

// Recover soft-deleted entries
app.post('/api/recover-entries/:companyId', (req, res) => {
  const cid = req.params.companyId;
  let count;
  if (cid === '_all_') {
    count = db.prepare('SELECT COUNT(*) as c FROM entries WHERE deleted = 1').get().c;
    db.prepare('UPDATE entries SET deleted = 0 WHERE deleted = 1').run();
  } else {
    count = db.prepare('SELECT COUNT(*) as c FROM entries WHERE company_id = ? AND deleted = 1').get(cid).c;
    db.prepare('UPDATE entries SET deleted = 0 WHERE company_id = ? AND deleted = 1').run(cid);
  }
  res.json({ ok: true, count });
});

// Purge soft-deleted entries permanently
app.post('/api/purge-entries/:companyId', (req, res) => {
  const cid = req.params.companyId;
  let count;
  if (cid === '_all_') {
    count = db.prepare('SELECT COUNT(*) as c FROM entries WHERE deleted = 1').get().c;
    db.prepare('DELETE FROM entry_lines WHERE entry_id IN (SELECT id FROM entries WHERE deleted = 1)').run();
    db.prepare('DELETE FROM entries WHERE deleted = 1').run();
  } else {
    count = db.prepare('SELECT COUNT(*) as c FROM entries WHERE company_id = ? AND deleted = 1').get(cid).c;
    db.prepare('DELETE FROM entry_lines WHERE entry_id IN (SELECT id FROM entries WHERE company_id = ? AND deleted = 1)').run(cid);
    db.prepare('DELETE FROM entries WHERE company_id = ? AND deleted = 1').run(cid);
  }
  res.json({ ok: true, count });
});

// ── TRANSACTIONS (bank imports) ──
app.get('/api/transactions/:companyId', (req, res) => {
  const rows = db.prepare('SELECT * FROM transactions WHERE company_id = ? ORDER BY date').all(req.params.companyId);
  res.json(rows.map(r => ({ ...r, del: !!r.deleted, matched: !!r.matched })));
});

app.post('/api/transactions/:companyId', (req, res) => {
  const insert = db.prepare('INSERT OR REPLACE INTO transactions (id, date, amount, description, matched, matched_account, matched_rule, iva, paid_by, company_id, deleted) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)');
  const tx = db.transaction(() => {
    (req.body.transactions || []).forEach(t => {
      insert.run(t.id, t.date, t.amount, t.desc || t.description, t.matched ? 1 : 0, t.mAcct || t.matched_account, t.mRule || t.matched_rule, t.iv || t.iva, t.paidBy || t.paid_by, req.params.companyId);
    });
  });
  tx();
  res.json({ ok: true, count: (req.body.transactions || []).length });
});

// ── RULES ──
app.get('/api/rules/:companyId', (req, res) => {
  const rows = db.prepare('SELECT id, pattern as p, account as a, description as d, priority as pr, iva as iv FROM rules WHERE company_id = ?').all(req.params.companyId);
  res.json(rows);
});

app.post('/api/rules/:companyId', (req, res) => {
  const { id, p, a, d, pr, iv } = req.body;
  db.prepare('INSERT OR REPLACE INTO rules VALUES (?, ?, ?, ?, ?, ?, ?)').run(id, p, a, d, pr || 1, iv || 'na', req.params.companyId);
  res.json({ ok: true });
});

app.delete('/api/rules/:companyId/:id', (req, res) => {
  db.prepare('DELETE FROM rules WHERE id = ? AND company_id = ?').run(req.params.id, req.params.companyId);
  res.json({ ok: true });
});

// ── MASTERS (clients, suppliers, banks) ──
app.get('/api/masters/:companyId/:type', (req, res) => {
  const rows = db.prepare('SELECT id, data FROM masters WHERE company_id = ? AND type = ?').all(req.params.companyId, req.params.type);
  res.json(rows.map(r => ({ id: r.id, ...JSON.parse(r.data) })));
});

app.post('/api/masters/:companyId/:type', (req, res) => {
  const { id, ...data } = req.body;
  db.prepare('INSERT OR REPLACE INTO masters VALUES (?, ?, ?, ?)').run(id, req.params.type, JSON.stringify(data), req.params.companyId);
  res.json({ ok: true });
});

app.delete('/api/masters/:companyId/:type/:id', (req, res) => {
  db.prepare('DELETE FROM masters WHERE id = ? AND type = ? AND company_id = ?').run(req.params.id, req.params.type, req.params.companyId);
  res.json({ ok: true });
});

// ── BACKUP ──
app.get('/api/backup/:companyId', (req, res) => {
  const cid = req.params.companyId;
  const data = {
    version: '6.1',
    date: new Date().toISOString().slice(0, 10),
    company: db.prepare('SELECT * FROM companies WHERE id = ?').get(cid),
    accounts: db.prepare('SELECT code, name, group_num as g, type as t FROM accounts WHERE company_id = ?').all(cid),
    entries: (() => {
      const entries = db.prepare('SELECT * FROM entries WHERE company_id = ?').all(cid);
      const lines = db.prepare('SELECT * FROM entry_lines WHERE entry_id IN (SELECT id FROM entries WHERE company_id = ?)').all(cid);
      const lineMap = {};
      lines.forEach(l => { if (!lineMap[l.entry_id]) lineMap[l.entry_id] = []; lineMap[l.entry_id].push({ a: l.account, d: l.debit, h: l.credit }); });
      return entries.map(e => ({ ...e, del: !!e.deleted, lines: lineMap[e.id] || [] }));
    })(),
    transactions: db.prepare('SELECT * FROM transactions WHERE company_id = ?').all(cid),
    rules: db.prepare('SELECT id, pattern as p, account as a, description as d, priority as pr, iva as iv FROM rules WHERE company_id = ?').all(cid),
    masters: db.prepare('SELECT * FROM masters WHERE company_id = ?').all(cid),
  };
  res.json(data);
});
// — OCR via Claude API —
app.post('/api/ocr', async (req, res) => {
    try {
          const { imageBase64, mediaType } = req.body;
          if (!imageBase64 || !mediaType) {
                  return res.status(400).json({ error: 'Faltan imageBase64 o mediaType' });
          }
          const response = await fetch('https://api.anthropic.com/v1/messages', {
                  method: 'POST',
                  headers: {
                            'Content-Type': 'application/json',
                            'x-api-key': process.env.ANTHROPIC_API_KEY,
                            'anthropic-version': '2023-06-01'
                  },
                  body: JSON.stringify({
                            model: 'claude-opus-4-5',
                            max_tokens: 1024,
                            messages: [{
                                        role: 'user',
                                        content: [
                                          { type: 'image', source: { type: 'base64', media_type: mediaType, data: imageBase64 } },
                                          { type: 'text', text: 'Extrae todos los datos de este ticket/factura. Devuelve SOLO un JSON con: establecimiento, fecha, total, productos (array con nombre y precio). Sin explicaciones.' }
                                                    ]
                            }]
                  })
          });
          if (!response.ok) {
                  const err = await response.json();
                  return res.status(response.status).json({ error: err });
          }
          const data = await response.json();
          res.json({ result: data.content[0].text });
    } catch (err) {
          console.error('Error en /api/ocr:', err);
          res.status(500).json({ error: err.message });
    }
});

// ── USERS MANAGEMENT ──
app.get('/api/users/:companyId', (req, res) => {
  const rows = db.prepare('SELECT id, username, name, role, company_id FROM users WHERE company_id = ?').all(req.params.companyId);
  res.json(rows);
});

app.post('/api/users/:companyId', (req, res) => {
  const { id, username, password, name, role } = req.body;
  try {
    db.prepare('INSERT OR REPLACE INTO users VALUES (?, ?, ?, ?, ?, ?)').run(id, username, password, name, role || 'user', req.params.companyId);
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.delete('/api/users/:companyId/:id', (req, res) => {
  db.prepare('DELETE FROM users WHERE id = ? AND company_id = ?').run(req.params.id, req.params.companyId);
  res.json({ ok: true });
});

// ── COMPANIES MANAGEMENT ──
app.get('/api/companies', (req, res) => {
  const rows = db.prepare('SELECT * FROM companies').all();
  res.json(rows);
});

app.post('/api/companies', (req, res) => {
  const { id, name, cif, address, config } = req.body;
  try {
    db.prepare('INSERT OR REPLACE INTO companies VALUES (?, ?, ?, ?, ?)').run(id, name, cif || '', address || '', config || '{}');
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ── SPA fallback ──
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

// ── Start ──
app.listen(PORT, '0.0.0.0', () => {
  console.log(`✓ Cimafondos v6.9.7 running on port ${PORT}`);
  console.log(`  Database: ${DB_PATH}`);
});
