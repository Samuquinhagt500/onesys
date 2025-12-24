/* ARQUIVO: main.js (V29 - SISTEMA COMPLETO: RH + FINANCEIRO + OBRAS + CLIENTES + PONTO) */
const { app, BrowserWindow, ipcMain } = require('electron');
const { Client } = require('pg');

// SEU LINK DO SUPABASE
const CONNECTION_STRING = 'postgresql://postgres.ooqltcwnjghmceaeetby:W4p8aLC1z3TiQUE0@aws-1-us-east-1.pooler.supabase.com:6543/postgres';

const dbConfig = {
    connectionString: CONNECTION_STRING,
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 10000 
};

let win;
let usuarioLogado = null;

async function dbQuery(sql, params = []) {
    const client = new Client(dbConfig);
    try {
        await client.connect();
        const res = await client.query(sql, params);
        await client.end();
        return res.rows;
    } catch (err) { console.error("Erro SQL:", err.message); throw err; }
}

async function registrarLog(acao, detalhes) {
    if (!usuarioLogado) return;
    try { await dbQuery("INSERT INTO system_logs (usuario, acao, detalhes) VALUES ($1, $2, $3)", [usuarioLogado.username, acao, detalhes]); } catch (e) {}
}

// --- CONFIGURAÇÃO E REPARO DO BANCO ---
async function configurarBanco() {
    const client = new Client(dbConfig);
    try {
        await client.connect();
        console.log("--- SINCRONIZANDO E REPARANDO BANCO (V29) ---");
        
        // 1. TABELAS BASE
        await client.query(`CREATE TABLE IF NOT EXISTS users (id SERIAL PRIMARY KEY, username TEXT UNIQUE, password_hash TEXT, cargo TEXT)`);
        await client.query(`CREATE TABLE IF NOT EXISTS clients (id SERIAL PRIMARY KEY, nome TEXT, documento TEXT, email TEXT, telefone TEXT, endereco TEXT, data_cadastro TIMESTAMP DEFAULT NOW())`);
        await client.query(`CREATE TABLE IF NOT EXISTS finance_categories (id SERIAL PRIMARY KEY, nome TEXT UNIQUE, tipo TEXT)`);
        
        // 2. RH (GARANTIA DE COLUNAS)
        await client.query(`CREATE TABLE IF NOT EXISTS employees (id SERIAL PRIMARY KEY, nome TEXT, cargo TEXT, salario NUMERIC, status TEXT DEFAULT 'ATIVO')`);
        const rhCols = ["cpf", "rg", "nis", "data_nascimento", "endereco", "email", "telefone", "admissao_data", "desligamento_data", "desligamento_motivo"];
        for(let col of rhCols) { try { await client.query(`ALTER TABLE employees ADD COLUMN IF NOT EXISTS ${col} TEXT`); } catch(e){} }

        // 3. FINANCEIRO (REPARO)
        await client.query(`CREATE TABLE IF NOT EXISTS finance_entries (id SERIAL PRIMARY KEY, tipo TEXT, descricao TEXT, valor NUMERIC)`);
        try { await client.query("ALTER TABLE finance_entries ADD COLUMN IF NOT EXISTS categoria_id INTEGER REFERENCES finance_categories(id)"); } catch(e){}
        try { await client.query("ALTER TABLE finance_entries ADD COLUMN IF NOT EXISTS data_vencimento DATE"); } catch(e){}
        try { await client.query("ALTER TABLE finance_entries ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'PENDENTE'"); } catch(e){}
        try { await client.query("ALTER TABLE finance_entries ADD COLUMN IF NOT EXISTS data_pagamento DATE"); } catch(e){}

        // 4. OBRAS (REPARO)
        await client.query(`CREATE TABLE IF NOT EXISTS projects (id SERIAL PRIMARY KEY, nome_obra TEXT, status TEXT DEFAULT 'ATIVA')`);
        try { await client.query("ALTER TABLE projects ADD COLUMN IF NOT EXISTS cliente_id INTEGER REFERENCES clients(id)"); } catch(e){}
        try { await client.query("ALTER TABLE projects ADD COLUMN IF NOT EXISTS engenheiro_id INTEGER REFERENCES users(id)"); } catch(e){}
        try { await client.query("ALTER TABLE projects ADD COLUMN IF NOT EXISTS mestre_id INTEGER REFERENCES users(id)"); } catch(e){}
        try { await client.query("ALTER TABLE projects ADD COLUMN IF NOT EXISTS orcamento NUMERIC DEFAULT 0"); } catch(e){}

        // 5. PONTO (NOVO)
        await client.query(`CREATE TABLE IF NOT EXISTS project_attendance (id SERIAL PRIMARY KEY, project_id INTEGER, employee_id INTEGER REFERENCES employees(id), data_registro DATE DEFAULT CURRENT_DATE, status TEXT, obs TEXT)`);

        // 6. OUTROS
        await client.query(`CREATE TABLE IF NOT EXISTS employee_docs (id SERIAL PRIMARY KEY, employee_id INTEGER REFERENCES employees(id) ON DELETE CASCADE, nome_arquivo TEXT, tipo_arquivo TEXT, conteudo TEXT)`);
        await client.query(`CREATE TABLE IF NOT EXISTS system_logs (id SERIAL PRIMARY KEY, usuario TEXT, acao TEXT, detalhes TEXT, data_hora TIMESTAMP DEFAULT NOW())`);
        await client.query(`CREATE TABLE IF NOT EXISTS employee_history (id SERIAL PRIMARY KEY, employee_id INTEGER REFERENCES employees(id) ON DELETE CASCADE, tipo TEXT, data_evento DATE DEFAULT CURRENT_DATE, descricao TEXT)`);
        await client.query(`CREATE TABLE IF NOT EXISTS job_roles (id SERIAL PRIMARY KEY, titulo TEXT UNIQUE, salario_base NUMERIC, bonificacao NUMERIC DEFAULT 0)`);
        await client.query(`CREATE TABLE IF NOT EXISTS products (id SERIAL PRIMARY KEY, nome TEXT, categoria TEXT, quantidade INTEGER, valor_unitario NUMERIC)`);

        // ADMIN
        const checkAdmin = await client.query("SELECT * FROM users WHERE username = 'admin'");
        if (checkAdmin.rows.length === 0) await client.query("INSERT INTO users (username, password_hash, cargo) VALUES ('admin', 'admin', 'admin')");
        
        await client.end();
        console.log("✅ BANCO DE DADOS ATUALIZADO (V29).");
    } catch (err) { console.log("Erro Banco:", err.message); }
}
configurarBanco();

function createWindow() {
    win = new BrowserWindow({ width: 1300, height: 950, title: 'OneSys Construtora v29', webPreferences: { nodeIntegration: true, contextIsolation: false } });
    win.setMenuBarVisibility(false);
    win.loadFile('login.html');
}
app.whenReady().then(createWindow);

// ==========================================
// HANDLERS (AÇÕES DO SISTEMA)
// ==========================================

// --- CLIENTES ---
ipcMain.handle('get-clients', async () => await dbQuery("SELECT * FROM clients ORDER BY nome ASC"));
ipcMain.handle('add-client', async (e, d) => { await dbQuery(`INSERT INTO clients (nome, documento, email, telefone, endereco) VALUES ($1, $2, $3, $4, $5)`, [d.nome, d.doc, d.email, d.tel, d.end]); return true; });

// --- OBRAS ---
ipcMain.handle('get-projects', async () => {
    let sql = `SELECT p.*, c.nome as cliente_nome, u1.username as engenheiro_nome, u2.username as mestre_nome 
               FROM projects p LEFT JOIN clients c ON p.cliente_id = c.id 
               LEFT JOIN users u1 ON p.engenheiro_id = u1.id LEFT JOIN users u2 ON p.mestre_id = u2.id`;
    if (usuarioLogado && usuarioLogado.cargo === 'gerente') sql += ` WHERE p.mestre_id = ${usuarioLogado.id}`;
    return await dbQuery(sql + " ORDER BY p.id DESC");
});
ipcMain.handle('add-project', async (e, d) => { await dbQuery(`INSERT INTO projects (nome_obra, cliente_id, orcamento, engenheiro_id, mestre_id) VALUES ($1, $2, $3, $4, $5)`, [d.nome, d.clienteId, d.orc, d.engId, d.mestreId]); return true; });

// --- PONTO (CANTEIRO) ---
ipcMain.handle('add-ponto', async (e, d) => {
    const check = await dbQuery("SELECT * FROM project_attendance WHERE project_id=$1 AND employee_id=$2 AND data_registro=CURRENT_DATE", [d.obraId, d.funcId]);
    if (check.length > 0) { await dbQuery("UPDATE project_attendance SET status=$1 WHERE id=$2", [d.status, check[0].id]); } else { await dbQuery("INSERT INTO project_attendance (project_id, employee_id, status) VALUES ($1, $2, $3)", [d.obraId, d.funcId, d.status]); }
    return true;
});
ipcMain.handle('get-ponto-obra', async (e, obraId) => { return await dbQuery(`SELECT pa.*, e.nome as nome_funcionario FROM project_attendance pa JOIN employees e ON pa.employee_id = e.id WHERE pa.project_id = $1 ORDER BY pa.data_registro DESC`, [obraId]); });

// --- FINANCEIRO ---
ipcMain.handle('get-finance', async () => { 
    const lista = await dbQuery(`SELECT fe.*, fc.nome as nome_categoria FROM finance_entries fe LEFT JOIN finance_categories fc ON fe.categoria_id = fc.id ORDER BY fe.data_vencimento ASC`);
    let saldo = 0; lista.forEach(x => { if (x.status === 'PAGO') x.tipo === 'RECEITA' ? saldo += parseFloat(x.valor) : saldo -= parseFloat(x.valor); }); 
    return {lista, saldo}; 
});
ipcMain.handle('add-finance', async (e, d) => { 
    const dp = d.status === 'PAGO' ? new Date() : null;
    await dbQuery(`INSERT INTO finance_entries (tipo, descricao, valor, categoria_id, data_vencimento, status, data_pagamento) VALUES ($1, $2, $3, $4, $5, $6, $7)`, [d.tipo, d.desc, d.valor, d.categoriaId, d.vencimento, d.status, dp]);
    return true;
});
ipcMain.handle('pay-finance', async (e, id) => { await dbQuery("UPDATE finance_entries SET status='PAGO', data_pagamento=CURRENT_DATE WHERE id=$1", [id]); return {sucesso:true}; });
ipcMain.handle('delete-finance', async (e, id) => { await dbQuery("DELETE FROM finance_entries WHERE id=$1", [id]); return {sucesso:true}; });
ipcMain.handle('get-categories', async () => await dbQuery("SELECT * FROM finance_categories ORDER BY nome ASC"));
ipcMain.handle('add-category', async (e, d) => { try { await dbQuery("INSERT INTO finance_categories (nome, tipo) VALUES ($1, $2)", [d.nome, d.tipo]); return {sucesso:true}; } catch(e){ return {sucesso:false}; } });

// --- RH ---
ipcMain.handle('get-employees', async () => await dbQuery("SELECT * FROM employees ORDER BY nome ASC"));
ipcMain.handle('add-employee-full', async (e, d) => {
    const client = new Client(dbConfig); await client.connect();
    const res = await client.query(`INSERT INTO employees (nome, cpf, rg, nis, data_nascimento, telefone, email, endereco, cargo, salario, status) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'ATIVO') RETURNING id`, [d.nome, d.cpf, d.rg, d.nis, d.nasc, d.tel, d.email, d.end, d.cargo, d.sal]);
    const novoId = res.rows[0].id;
    if (d.docs) { for (const doc of d.docs) { await client.query("INSERT INTO employee_docs (employee_id, nome_arquivo, tipo_arquivo, conteudo) VALUES ($1, $2, $3, $4)", [novoId, doc.name, doc.type, doc.content]); } }
    await client.end(); return true;
});
ipcMain.handle('terminate-employee', async (e, d) => {
    const checkPass = await dbQuery("SELECT * FROM users WHERE id=$1 AND password_hash=$2", [usuarioLogado.id, d.adminPass]);
    if (checkPass.length === 0) return { sucesso: false, msg: "SENHA INCORRETA!" };
    await dbQuery("UPDATE employees SET status = 'INATIVO', desligamento_data = CURRENT_DATE, desligamento_motivo = $2 WHERE id = $1", [d.id, d.motivo]);
    return { sucesso: true };
});

// --- SISTEMA ---
ipcMain.handle('login-auth', async (e, d) => { const users = await dbQuery("SELECT * FROM users WHERE username=$1 AND password_hash=$2", [d.user, d.pass]); if (users.length > 0) { usuarioLogado = users[0]; win.loadFile('dashboard.html'); return { sucesso: true }; } return { sucesso: false }; });
ipcMain.handle('get-user-info', () => usuarioLogado);
ipcMain.handle('get-system-users', async () => await dbQuery("SELECT id, username, cargo FROM users ORDER BY username ASC"));
ipcMain.handle('save-user', async (e, d) => { if (d.id) { await dbQuery("UPDATE users SET username=$1, cargo=$2 WHERE id=$3", [d.user, d.cargo, d.id]); if(d.pass) await dbQuery("UPDATE users SET password_hash=$1 WHERE id=$2", [d.pass, d.id]); } else { await dbQuery("INSERT INTO users (username, password_hash, cargo) VALUES ($1, $2, $3)", [d.user, d.pass, d.cargo]); } return { sucesso: true }; });
ipcMain.handle('get-employee-details', async (e, id) => { const history = await dbQuery("SELECT * FROM employee_history WHERE employee_id=$1 ORDER BY data_evento DESC", [id]); const docs = await dbQuery("SELECT id, nome_arquivo, tipo_arquivo FROM employee_docs WHERE employee_id=$1", [id]); return { history, docs }; });
ipcMain.handle('upload-doc', async (e, d) => { await dbQuery("INSERT INTO employee_docs (employee_id, nome_arquivo, tipo_arquivo, conteudo) VALUES ($1, $2, $3, $4)", [d.id, d.nome, d.tipo, d.content]); return true; });
ipcMain.handle('get-products', async () => await dbQuery("SELECT * FROM products ORDER BY nome ASC"));
ipcMain.handle('add-product', async (e, d) => { await dbQuery("INSERT INTO products (nome, categoria, quantidade, valor_unitario) VALUES ($1, $2, $3, $4)", [d.nome, d.cat, d.qtd, d.val]); return true; });
ipcMain.handle('get-audit-logs', async () => await dbQuery("SELECT * FROM system_logs ORDER BY id DESC LIMIT 100"));
ipcMain.handle('get-roles', async () => await dbQuery("SELECT * FROM job_roles ORDER BY titulo ASC"));
ipcMain.handle('add-role', async (e, d) => { await dbQuery("INSERT INTO job_roles (titulo, salario_base, bonificacao) VALUES ($1, $2, $3)", [d.titulo, d.base, d.bonus]); return true; });
ipcMain.handle('edit-role', async (e, d) => { await dbQuery("UPDATE job_roles SET titulo=$1, salario_base=$2, bonificacao=$3 WHERE id=$4", [d.titulo, d.base, d.bonus, d.id]); return true; });
ipcMain.handle('delete-role', async (e, id) => { await dbQuery("DELETE FROM job_roles WHERE id=$1", [id]); return { sucesso: true }; });