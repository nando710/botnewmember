require('dotenv').config(); // Permite rodar localmente com arquivo .env se precisar
const express = require('express');
const axios = require('axios');
const app = express();
const port = process.env.PORT || 3000;

// --- CARREGANDO VARIÁVEIS DE AMBIENTE (DA COOLIFY) ---
const CLIENT_ID = process.env.CLIENT_ID;
const CLIENT_SECRET = process.env.CLIENT_SECRET;
const BOT_TOKEN = process.env.BOT_TOKEN;
const GUILD_ID = process.env.GUILD_ID;
const ROLE_ID = process.env.ROLE_ID;
const MEU_WEBHOOK_URL = process.env.MEU_WEBHOOK_URL;
const REDIRECT_URI = process.env.REDIRECT_URI; 
// -----------------------------------------------------

// Rota de Health Check (Para a Coolify saber que está online)
app.get('/', (req, res) => {
    res.status(200).send('Bot API is running correctly via Coolify! 🚀');
});

// Rota 1: Redireciona para o login do Discord
app.get('/login', (req, res) => {
    if (!CLIENT_ID || !REDIRECT_URI) {
        return res.status(500).send('Erro: Variáveis de ambiente CLIENT_ID ou REDIRECT_URI não configuradas.');
    }

    // Escopos: identificar, entrar no servidor, ver email
    const scopes = 'identify guilds.join email';
    const url = `https://discord.com/api/oauth2/authorize?client_id=${CLIENT_ID}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&response_type=code&scope=${encodeURIComponent(scopes)}`;
    
    res.redirect(url);
});

// Rota 2: O Callback (Onde a mágica acontece)
app.get('/callback', async (req, res) => {
    const { code } = req.query;

    if (!code) return res.send('Erro: Nenhum código fornecido pelo Discord.');

    try {
        // A. Trocar o código temporário pelo token de acesso do usuário
        const params = new URLSearchParams({
            client_id: CLIENT_ID,
            client_secret: CLIENT_SECRET,
            grant_type: 'authorization_code',
            code,
            redirect_uri: REDIRECT_URI,
        });

        const tokenResponse = await axios.post('https://discord.com/api/oauth2/token', params, {
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
        });

        const { access_token } = tokenResponse.data;

        // B. Pegar os dados do usuário (ID, Username, Email)
        const userResponse = await axios.get('https://discord.com/api/users/@me', {
            headers: { Authorization: `Bearer ${access_token}` }
        });
        
        const userData = userResponse.data;

        // C. Adicionar ao Servidor Discord + Dar o Cargo
        // Nota: Se o usuário já estiver no servidor, o Discord retorna 204.
        // O axios.put lida com a entrada ou atualização do membro.
        await axios.put(
            `https://discord.com/api/guilds/${GUILD_ID}/members/${userData.id}`,
            {
                access_token: access_token,
                roles: [ROLE_ID] 
            },
            {
                headers: {
                    'Authorization': `Bot ${BOT_TOKEN}`,
                    'Content-Type': 'application/json'
                }
            }
        );

        console.log(`Usuário ${userData.username} adicionado/atualizado no servidor.`);

        // D. Enviar Webhook para seu Banco de Dados / Backend
        if (MEU_WEBHOOK_URL) {
            try {
                await axios.post(MEU_WEBHOOK_URL, {
                    discord_id: userData.id,
                    username: userData.username,
                    email: userData.email,
                    avatar_url: `https://cdn.discordapp.com/avatars/${userData.id}/${userData.avatar}.png`,
                    data_entrada: new Date().toISOString(),
                    origem: "Coolify Bot"
                });
                console.log('Webhook de notificação enviado com sucesso.');
            } catch (webhookError) {
                console.error('Falha ao enviar webhook:', webhookError.message);
                // Não paramos o fluxo aqui, pois o usuário já entrou no servidor.
            }
        }

        // E. Resposta final bonita para o usuário
        res.send(`
            <!DOCTYPE html>
            <html lang="pt-BR">
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <title>Sucesso</title>
                <style>
                    body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background-color: #2c2f33; color: white; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; }
                    .container { text-align: center; background-color: #23272a; padding: 40px; border-radius: 10px; box-shadow: 0 4px 15px rgba(0,0,0,0.5); }
                    h1 { color: #5865F2; }
                    p { font-size: 1.1rem; }
                    .info { background: #1c1f22; padding: 15px; border-radius: 5px; margin: 20px 0; text-align: left; }
                    button { background-color: #5865F2; color: white; border: none; padding: 10px 20px; font-size: 1rem; border-radius: 5px; cursor: pointer; transition: 0.3s; }
                    button:hover { background-color: #4752c4; }
                </style>
            </head>
            <body>
                <div class="container">
                    <h1>Tudo certo! 🎉</h1>
                    <p>Você foi autenticado e adicionado ao servidor.</p>
                    <div class="info">
                        <strong>Usuário:</strong> ${userData.username}<br>
                        <strong>Email:</strong> ${userData.email}
                    </div>
                    <button onclick="window.close()">Fechar esta janela</button>
                </div>
            </body>
            </html>
        `);

    } catch (error) {
        console.error('Erro Crítico:', error.response ? error.response.data : error.message);
        res.status(500).send(`
            <h1>Ops, algo deu errado.</h1>
            <p>Verifique se sua conta do Discord já está verificada ou tente novamente mais tarde.</p>
        `);
    }
});

app.listen(port, () => {
    console.log(`API rodando na porta ${port}`);
});