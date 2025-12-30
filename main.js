/* ARQUIVO: main.js (V90 - FINAL BLINDADO) */
const { app, BrowserWindow, ipcMain } = require('electron');
const { Pool } = require('pg');

// CONEXÃO COM O BANCO DE DADOS (SUPABASE)
const CONNECTION_STRING = 'postgresql://postgres.ooqltcwnjghmceaeetby:W4p8aLC1z3TiQUE0@aws-1-us-east-1.pooler.supabase.com:6543/postgres';

const pool = new Pool({
    connectionString: CONNECTION_STRING,
    ssl: { rejectUnauthorized: false },
    max: 20, 
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 10000,
});

let win;
let usuarioLogado = null;

// FUNÇÃO GENÉRICA DE CONSULTA AO BANCO
async function dbQuery(sql, params = []) {
    try {
        const res = await pool.query(sql, params);
        return res.rows;
    } catch (err) {
        console.error("ERRO SQL:", err.message);
        throw err;
    }
}

// CRIAÇÃO DA JANELA PRINCIPAL
function createWindow() {
    win = new BrowserWindow({ 
        width: 1400, 
        height: 900, 
        title: 'OneSys Construtora - Sistema Integrado', 
        webPreferences: { 
            nodeIntegration: true, 
            contextIsolation: false 
        } 
    });
    win.setMenuBarVisibility(false);
    win.loadFile('login.html');
}

app.whenReady().then(createWindow);

// ========================================================
// HANDLERS (COMUNICAÇÃO FRONTEND <-> BACKEND)
// ========================================================

// 1. SISTEMA DE LOGIN E USUÁRIOS
ipcMain.handle('login-auth', async (e, d) => { 
    const users = await dbQuery("SELECT * FROM users WHERE username=$1 AND password_hash=$2", [d.user, d.pass]); 
    if (users.length > 0) { 
        usuarioLogado = users[0]; 
        win.loadFile('dashboard.html'); 
        return { sucesso: true }; 
    } 
    return { sucesso: false }; 
});

ipcMain.handle('get-user-info', () => usuarioLogado);

ipcMain.handle('get-system-users', async () => {
    return await dbQuery("SELECT id, username, cargo, reset_req FROM users ORDER BY username ASC");
});

ipcMain.handle('save-user', async (e, d) => { 
    if (d.id) { 
        await dbQuery("UPDATE users SET username=$1, cargo=$2 WHERE id=$3", [d.user, d.cargo, d.id]); 
        if(d.pass) await dbQuery("UPDATE users SET password_hash=$1 WHERE id=$2", [d.pass, d.id]); 
    } else { 
        await dbQuery("INSERT INTO users (username, password_hash, cargo) VALUES ($1, $2, $3)", [d.user, d.pass, d.cargo]); 
    } 
    return { sucesso: true }; 
});

ipcMain.handle('request-pass-reset', async (e, user) => {
    try {
        const u = await dbQuery("SELECT id FROM users WHERE username=$1", [user]);
        if(u.length === 0) return { sucesso: false, msg: "Usuário não encontrado." };
        await dbQuery("UPDATE users SET reset_req = TRUE WHERE id=$1", [u[0].id]);
        return { sucesso: true };
    } catch(err) { return { sucesso: false, msg: err.message }; }
});

ipcMain.handle('admin-reset-pass', async (e, id) => {
    try {
        const conf = await dbQuery("SELECT value FROM system_config WHERE key='default_pass'");
        const defaultPass = conf[0]?.value || '123456';
        await dbQuery("UPDATE users SET password_hash=$1, reset_req=FALSE WHERE id=$2", [defaultPass, id]);
        return { sucesso: true, novaSenha: defaultPass };
    } catch(err) { return { sucesso: false, msg: err.message }; }
});

ipcMain.handle('delete-user', async (e, id) => {
    await dbQuery("DELETE FROM users WHERE id=$1", [id]);
    return { sucesso: true };
});

// 2. CONFIGURAÇÕES DO SISTEMA
ipcMain.handle('save-sys-config', async (e, data) => {
    await dbQuery("INSERT INTO system_config (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = $2", [data.key, data.value]);
    return { sucesso: true };
});

ipcMain.handle('get-sys-config', async (e, key) => {
    const res = await dbQuery("SELECT value FROM system_config WHERE key=$1", [key]);
    return res[0]?.value || '';
});

ipcMain.handle('change-own-pass', async (e, d) => {
    await dbQuery("UPDATE users SET password_hash=$1 WHERE username=$2", [d.newPass, d.user]);
    return { sucesso: true };
});

// 3. GESTÃO DE OBRAS (PROJETOS)
ipcMain.handle('get-projects', async () => { 
    let sql = `SELECT p.*, c.nome as cliente_nome, u1.username as engenheiro_nome, u2.username as mestre_nome 
               FROM projects p 
               LEFT JOIN clients c ON p.cliente_id = c.id 
               LEFT JOIN users u1 ON p.engenheiro_id = u1.id 
               LEFT JOIN users u2 ON p.mestre_id = u2.id`; 
    
    if (usuarioLogado) {
        if (usuarioLogado.cargo === 'gerente') { sql += ` WHERE p.mestre_id = ${usuarioLogado.id}`; } 
        else if (usuarioLogado.cargo === 'engenharia') { sql += ` WHERE p.engenheiro_id = ${usuarioLogado.id}`; }
    }
    return await dbQuery(sql + " ORDER BY p.id DESC"); 
});

ipcMain.handle('save-project', async (e, d) => {
    if (d.id) {
        await dbQuery(`UPDATE projects SET nome_obra=$1, cliente_id=$2, orcamento=$3, engenheiro_id=$4, mestre_id=$5 WHERE id=$6`, 
        [d.nome, d.clienteId, d.orc, d.engId, d.mestreId, d.id]);
    } else {
        await dbQuery(`INSERT INTO projects (nome_obra, cliente_id, orcamento, engenheiro_id, mestre_id) VALUES ($1, $2, $3, $4, $5)`, 
        [d.nome, d.clienteId, d.orc, d.engId, d.mestreId]);
    }
    return true; 
});

// 4. ALMOXARIFADO E PRODUTOS
ipcMain.handle('get-products', async () => await dbQuery("SELECT * FROM products ORDER BY nome ASC"));

ipcMain.handle('save-product', async (e, d) => {
    if (d.id) await dbQuery("UPDATE products SET nome=$1, categoria=$2, quantidade=$3, valor_unitario=$4 WHERE id=$5", [d.nome, d.cat, d.qtd, d.val, d.id]);
    else await dbQuery("INSERT INTO products (nome, categoria, quantidade, valor_unitario) VALUES ($1, $2, $3, $4)", [d.nome, d.cat, d.qtd, d.val]);
    return true;
});

ipcMain.handle('delete-product', async (e, id) => { await dbQuery("DELETE FROM products WHERE id=$1", [id]); return true; });

ipcMain.handle('transfer-product', async (event, { prodId, obraId, qtd }) => {
    try {
        const produtos = await dbQuery(`SELECT * FROM products WHERE id = ${prodId}`);
        const produto = produtos[0];
        if (!produto || produto.quantidade < qtd) return { sucesso: false, msg: "Saldo insuficiente no Almoxarifado Central!" };

        await dbQuery(`UPDATE products SET quantidade = quantidade - ${qtd} WHERE id = ${prodId}`);
        const materialNaObra = await dbQuery(`SELECT * FROM project_materials WHERE obra_id = ${obraId} AND produto_id = ${prodId}`);

        if (materialNaObra.length > 0) {
            await dbQuery(`UPDATE project_materials SET quantidade = quantidade + ${qtd} WHERE id = ${materialNaObra[0].id}`);
        } else {
            await dbQuery(`INSERT INTO project_materials (obra_id, produto_id, quantidade) VALUES (${obraId}, ${prodId}, ${qtd})`);
        }
        
        // REGISTRA NO DIÁRIO DE OBRA (TIMELINE)
        await dbQuery(`INSERT INTO project_logs (project_id, tipo, descricao, data_log) VALUES ($1, 'MATERIAL', $2, NOW())`, 
            [obraId, `Recebido: ${qtd}x ${produto.nome}`]);

        return { sucesso: true };
    } catch (error) { return { sucesso: false, msg: "Erro ao processar transferência." }; }
});

ipcMain.handle('get-project-materials', async (event, obraId) => {
    return await dbQuery(`SELECT pm.*, p.nome as nome_material, p.categoria, p.valor_unitario 
                          FROM project_materials pm 
                          LEFT JOIN products p ON pm.produto_id = p.id 
                          WHERE pm.obra_id = ${obraId}`);
});

ipcMain.handle('consume-material', async (e, d) => {
    try {
        const mat = await dbQuery("SELECT pm.*, p.nome FROM project_materials pm LEFT JOIN products p ON pm.produto_id = p.id WHERE obra_id=$1 AND produto_id=$2", [d.obraId, d.prodId]);
        if (mat.length === 0 || mat[0].quantidade < d.qtd) return { sucesso: false, msg: "Quantidade indisponível na obra!" };
        
        await dbQuery("UPDATE project_materials SET quantidade = quantidade - $1 WHERE id=$2", [d.qtd, mat[0].id]);
        
        // REGISTRA CONSUMO NA TIMELINE
        await dbQuery(`INSERT INTO project_logs (project_id, tipo, descricao, data_log) VALUES ($1, 'MATERIAL', $2, NOW())`, 
            [d.obraId, `Consumo: ${d.qtd}x ${mat[0].nome}`]);

        return { sucesso: true };
    } catch (err) { return { sucesso: false, msg: err.message }; }
});

// 5. FINANCEIRO
ipcMain.handle('save-finance-entry', async (event, gasto) => {
    try {
        if (!gasto.id) {
            await dbQuery(`INSERT INTO finance_entries (tipo, descricao, valor, categoria_id, data_vencimento, status, data_pagamento) 
                           VALUES ($1, $2, $3, $4, $5, $6, $7)`, 
            [gasto.tipo, gasto.descricao, gasto.valor, gasto.categoria_id || null, gasto.data_vencimento, gasto.status || 'PENDENTE', gasto.status === 'PAGO' ? gasto.data_vencimento : null]);
            
            // SE TIVER ID DA OBRA, REGISTRA NA TIMELINE
            if(gasto.obra_id) {
                await dbQuery(`INSERT INTO project_logs (project_id, tipo, descricao, data_log, valor_extra) VALUES ($1, 'FINANCEIRO', $2, NOW(), $3)`, 
                [gasto.obra_id, `Gasto Registrado: ${gasto.descricao}`, gasto.valor]);
            }
        } 
        return true;
    } catch (error) { console.error(error); return false; }
}); 

ipcMain.handle('get-finance', async () => {
    const lista = await dbQuery(`SELECT fe.*, fc.nome as nome_categoria FROM finance_entries fe LEFT JOIN finance_categories fc ON fe.categoria_id = fc.id ORDER BY fe.data_vencimento ASC`);
    let saldo = 0;
    lista.forEach(x => {
        if (x.status === 'PAGO') x.tipo === 'RECEITA' ? saldo += parseFloat(x.valor) : saldo -= parseFloat(x.valor);
    });
    return {lista, saldo};
});

ipcMain.handle('add-finance', async (e, d) => {
    const dp = d.status === 'PAGO' ? new Date() : null;
    await dbQuery(`INSERT INTO finance_entries (tipo, descricao, valor, categoria_id, data_vencimento, status, data_pagamento) 
                   VALUES ($1, $2, $3, $4, $5, $6, $7)`, 
    [d.tipo, d.desc, d.valor, d.categoriaId, d.vencimento, d.status, dp]);
    return true;
});

ipcMain.handle('pay-finance', async (e, id) => {
    await dbQuery("UPDATE finance_entries SET status='PAGO', data_pagamento=CURRENT_DATE WHERE id=$1", [id]);
    return {sucesso:true};
});

ipcMain.handle('delete-finance', async (e, id) => {
    await dbQuery("DELETE FROM finance_entries WHERE id=$1", [id]);
    return {sucesso:true};
});

ipcMain.handle('get-categories', async () => await dbQuery("SELECT * FROM finance_categories ORDER BY nome ASC"));

ipcMain.handle('add-category', async (e, d) => {
    try { await dbQuery("INSERT INTO finance_categories (nome, tipo) VALUES ($1, $2)", [d.nome, d.tipo]); return {sucesso:true}; }
    catch(e){ return {sucesso:false}; }
});

// 6. RH (FUNCIONÁRIOS E PONTO)
ipcMain.handle('get-employees', async () => await dbQuery("SELECT * FROM employees ORDER BY nome ASC"));

ipcMain.handle('add-employee-full', async (e, d) => { 
    try {
        const res = await dbQuery(`INSERT INTO employees (nome, cpf, rg, nis, data_nascimento, telefone, email, endereco, cargo, salario, status) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'ATIVO') RETURNING id`, [d.nome, d.cpf, d.rg, d.nis, d.nasc, d.tel, d.email, d.end, d.cargo, d.sal]); 
        const novoId = res[0].id; 
        await dbQuery("INSERT INTO employee_history (employee_id, tipo, descricao, data_evento) VALUES ($1, 'ADMISSAO', $2, NOW())", [novoId, `Admitido como ${d.cargo}`]);
        if (d.docs) { 
            for (const doc of d.docs) { 
                await dbQuery("INSERT INTO employee_documents (employee_id, nome_arquivo, tipo_arquivo, conteudo) VALUES ($1, $2, $3, $4)", [novoId, doc.name, doc.type, doc.content]); 
            } 
        } 
        return { sucesso: true };
    } catch(err) { console.error(err); return { sucesso: false }; }
});

ipcMain.handle('terminate-employee', async (e, d) => { 
    const checkPass = await dbQuery("SELECT * FROM users WHERE id=$1 AND password_hash=$2", [usuarioLogado.id, d.adminPass]); 
    if (checkPass.length === 0) return { sucesso: false, msg: "SENHA INCORRETA!" }; 
    await dbQuery("UPDATE employees SET status = 'INATIVO', desligamento_data = CURRENT_DATE, desligamento_motivo = $2 WHERE id = $1", [d.id, d.motivo]); 
    await dbQuery("INSERT INTO employee_history (employee_id, tipo, descricao, data_evento) VALUES ($1, 'DESLIGAMENTO', $2, NOW())", [d.id, d.motivo]);
    return { sucesso: true }; 
});

ipcMain.handle('add-ponto', async (e, d) => {
    const check = await dbQuery("SELECT * FROM project_attendance WHERE project_id=$1 AND employee_id=$2 AND data_registro=CURRENT_DATE", [d.obraId, d.funcId]);
    if (check.length > 0) {
        await dbQuery("UPDATE project_attendance SET status=$1 WHERE id=$2", [d.status, check[0].id]);
    } else {
        await dbQuery("INSERT INTO project_attendance (project_id, employee_id, status) VALUES ($1, $2, $3)", [d.obraId, d.funcId, d.status]);
    }
    return true;
});

ipcMain.handle('get-ponto-obra', async (e, obraId) => {
    return await dbQuery(`SELECT pa.*, e.nome as nome_funcionario FROM project_attendance pa JOIN employees e ON pa.employee_id = e.id WHERE pa.project_id = $1 ORDER BY pa.data_registro DESC`, [obraId]);
});

ipcMain.handle('get-employee-details', async (event, id) => {
    try {
        const info = await dbQuery("SELECT * FROM employees WHERE id = $1", [id]);
        const history = await dbQuery("SELECT * FROM employee_history WHERE employee_id = $1 ORDER BY data_evento DESC", [id]);
        const docs = await dbQuery("SELECT * FROM employee_documents WHERE employee_id = $1", [id]);
        return { info: info[0], history: history, docs: docs };
    } catch (err) { console.error(err); return { info: {}, history: [], docs: [] }; }
});

ipcMain.handle('add-employee-event', async (event, data) => {
    try {
        const dataFinal = data.dataEvento || 'NOW()';
        await dbQuery(`INSERT INTO employee_history (employee_id, tipo, descricao, data_evento) VALUES ($1, $2, $3, $4)`, [data.empId, data.tipo, data.desc, dataFinal]);
        return { sucesso: true };
    } catch (err) { return { sucesso: false, msg: err.message }; }
});

ipcMain.handle('get-notifications', async () => {
    try {
        const alertasRH = await dbQuery(`SELECT nome, aso_vencimento, ferias_inicio, 'RH' as origem FROM employees WHERE (aso_vencimento <= NOW() + INTERVAL '30 days' AND status = 'ATIVO') OR (ferias_inicio <= NOW() + INTERVAL '15 days' AND status = 'ATIVO')`);
        const alertasSys = await dbQuery(`SELECT username as nome, 'SYS' as origem FROM users WHERE reset_req = TRUE`);
        return [...alertasRH, ...alertasSys];
    } catch (err) { return []; }
});

// 7. CLIENTES E CARGOS
ipcMain.handle('get-clients', async () => await dbQuery("SELECT * FROM clients ORDER BY nome ASC"));

ipcMain.handle('save-client', async (e, d) => { 
    if (d.id) await dbQuery("UPDATE clients SET nome=$1, documento=$2, email=$3, telefone=$4, endereco=$5 WHERE id=$6", [d.nome, d.doc, d.email, d.tel, d.end, d.id]); 
    else await dbQuery("INSERT INTO clients (nome, documento, email, telefone, endereco, status) VALUES ($1, $2, $3, $4, $5, 'ATIVO')", [d.nome, d.doc, d.email, d.tel, d.end]); 
    return true; 
});

ipcMain.handle('archive-client', async (e, id) => { await dbQuery("UPDATE clients SET status='INATIVO' WHERE id=$1", [id]); return true; });

ipcMain.handle('upload-doc', async (e, d) => { await dbQuery("INSERT INTO employee_documents (employee_id, nome_arquivo, tipo_arquivo, conteudo) VALUES ($1, $2, $3, $4)", [d.id, d.nome, d.tipo, d.content]); return true; });

ipcMain.handle('get-roles', async () => await dbQuery("SELECT * FROM job_roles ORDER BY titulo ASC"));
ipcMain.handle('add-role', async (e, d) => { await dbQuery("INSERT INTO job_roles (titulo, salario_base, bonificacao) VALUES ($1, $2, $3)", [d.titulo, d.base, d.bonus]); return true; });
ipcMain.handle('edit-role', async (e, d) => { await dbQuery("UPDATE job_roles SET titulo=$1, salario_base=$2, bonificacao=$3 WHERE id=$4", [d.titulo, d.base, d.bonus, d.id]); return true; });
ipcMain.handle('delete-role', async (e, id) => { await dbQuery("DELETE FROM job_roles WHERE id=$1", [id]); return { sucesso: true }; });

// 8. VENDAS (ORÇAMENTOS)
ipcMain.handle('get-budgets', async () => {
    return await dbQuery(`SELECT b.*, c.nome as cliente_nome FROM budgets b LEFT JOIN clients c ON b.cliente_id = c.id ORDER BY b.id DESC`);
});

ipcMain.handle('save-budget', async (e, data) => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        let budgetId = data.id;
        if (!budgetId) {
            const res = await client.query(`INSERT INTO budgets (cliente_id, valor_total, data_emissao, status) VALUES ($1, $2, NOW(), 'PENDENTE') RETURNING id`, [data.clienteId, data.total]);
            budgetId = res.rows[0].id;
        } else {
            await client.query(`UPDATE budgets SET cliente_id=$1, valor_total=$2 WHERE id=$3`, [data.clienteId, data.total, budgetId]);
            await client.query(`DELETE FROM budget_items WHERE budget_id=$1`, [budgetId]);
        }
        for (const item of data.items) {
            await client.query(`INSERT INTO budget_items (budget_id, descricao, categoria, valor) VALUES ($1, $2, $3, $4)`, [budgetId, item.desc, item.cat, item.val]);
        }
        await client.query('COMMIT');
        return { sucesso: true };
    } catch (err) {
        await client.query('ROLLBACK');
        return { sucesso: false, msg: err.message };
    } finally {
        client.release();
    }
});

// 9. CRONOGRAMA, FOTOS E TIMELINE (COM PROTEÇÃO)
ipcMain.handle('get-project-tasks', async (e, obraId) => {
    // PROTEÇÃO: Garante que obraId é um número. Se for objeto vazio {}, retorna vazio.
    const id = parseInt(obraId);
    if(isNaN(id)) return []; 
    return await dbQuery("SELECT * FROM project_tasks WHERE project_id = $1 ORDER BY categoria ASC", [id]);
});

ipcMain.handle('save-task-update', async (e, d) => {
    try {
        const check = await dbQuery("SELECT * FROM project_tasks WHERE project_id=$1 AND categoria=$2", [d.obraId, d.categoria]);
        if (check.length > 0) {
            let sql = "UPDATE project_tasks SET progresso=$1, prazo=$2 WHERE id=$3";
            let params = [d.progresso, d.prazo, check[0].id];
            
            // SE TIVER FOTO, ATUALIZA FOTO E CRIA LOG
            if (d.foto) {
                sql = "UPDATE project_tasks SET progresso=$1, prazo=$2, foto_recente=$3 WHERE id=$4";
                params = [d.progresso, d.prazo, d.foto, check[0].id];
                await dbQuery(`INSERT INTO project_logs (project_id, tipo, descricao, data_log, foto_base64) VALUES ($1, 'FOTO', $2, NOW(), $3)`, [d.obraId, `Foto: ${d.categoria}`, d.foto]);
            }
            // SE MUDOU PROGRESSO, CRIA LOG
            else if (d.progresso !== null && d.progresso !== check[0].progresso) {
                await dbQuery(`INSERT INTO project_logs (project_id, tipo, descricao, data_log) VALUES ($1, 'PROGRESSO', $2, NOW())`, [d.obraId, `${d.categoria}: ${d.progresso}%`]);
            }
            
            await dbQuery(sql, params);
        } else {
            await dbQuery("INSERT INTO project_tasks (project_id, categoria, progresso, prazo, foto_recente) VALUES ($1, $2, $3, $4, $5)", [d.obraId, d.categoria, d.progresso, d.prazo, d.foto || null]);
        }
        return { sucesso: true };
    } catch(err) { return { sucesso: false, msg: err.message }; }
});

ipcMain.handle('get-project-timeline', async (e, obraId) => {
    const id = parseInt(obraId);
    if(isNaN(id)) return [];
    return await dbQuery("SELECT * FROM project_logs WHERE project_id = $1 ORDER BY data_log DESC", [id]);
});

ipcMain.handle('add-timeline-note', async (e, d) => {
    await dbQuery(`INSERT INTO project_logs (project_id, tipo, descricao, data_log, foto_base64) VALUES ($1, 'DIARIO', $2, NOW(), $3)`, [d.obraId, d.texto, d.foto]);
    return { sucesso: true };
});

// SCRIPT DE INICIALIZAÇÃO DO BANCO (AUTO-CORREÇÃO)
setTimeout(async () => {
    console.log(">>> VERIFICANDO INTEGRIDADE DO BANCO DE DADOS (V90)...");
    try {
        await dbQuery(`CREATE TABLE IF NOT EXISTS system_config (key TEXT PRIMARY KEY, value TEXT);`);
        await dbQuery(`INSERT INTO system_config (key, value) VALUES ('default_pass', 'mudar123') ON CONFLICT DO NOTHING;`);
        await dbQuery(`ALTER TABLE employees ADD COLUMN IF NOT EXISTS aso_vencimento DATE;`);
        await dbQuery(`ALTER TABLE employees ADD COLUMN IF NOT EXISTS ferias_inicio DATE;`);
        await dbQuery(`ALTER TABLE employees ADD COLUMN IF NOT EXISTS rg TEXT;`);
        await dbQuery(`ALTER TABLE users ADD COLUMN IF NOT EXISTS reset_req BOOLEAN DEFAULT FALSE;`);
        
        // TABELAS NOVAS
        await dbQuery(`CREATE TABLE IF NOT EXISTS budgets (id SERIAL PRIMARY KEY, cliente_id INTEGER REFERENCES clients(id), valor_total NUMERIC, data_emissao DATE, status TEXT);`);
        await dbQuery(`CREATE TABLE IF NOT EXISTS budget_items (id SERIAL PRIMARY KEY, budget_id INTEGER REFERENCES budgets(id), descricao TEXT, categoria TEXT, valor NUMERIC);`);
        await dbQuery(`CREATE TABLE IF NOT EXISTS project_tasks (id SERIAL PRIMARY KEY, project_id INTEGER REFERENCES projects(id), categoria TEXT, progresso INTEGER DEFAULT 0, prazo DATE, foto_recente TEXT);`);
        await dbQuery(`CREATE TABLE IF NOT EXISTS project_logs (id SERIAL PRIMARY KEY, project_id INT, tipo TEXT, descricao TEXT, data_log TIMESTAMP DEFAULT NOW(), valor_extra NUMERIC, foto_base64 TEXT);`);
        
        console.log("✅ BANCO DE DADOS OK.");
    } catch (err) { console.error("Erro DB Init:", err.message); }
}, 3000);