require('dotenv').config();
const express = require('express');
const axios = require('axios');
const app = express();
const port = process.env.PORT || 3000;

// --- VARIÁVEIS DE AMBIENTE ---
const CLIENT_ID = process.env.CLIENT_ID;
const CLIENT_SECRET = process.env.CLIENT_SECRET;
const BOT_TOKEN = process.env.BOT_TOKEN;
const GUILD_ID = process.env.GUILD_ID;
const ROLE_ID = process.env.ROLE_ID;
const MEU_WEBHOOK_URL = process.env.MEU_WEBHOOK_URL;
const REDIRECT_URI = process.env.REDIRECT_URI; 
// -----------------------------

app.get('/', (req, res) => {
    res.status(200).send('Auth Bot com State Pass-through rodando! 🚀');
});

// ROTA DE LOGIN (Agora aceita ?email=...)
app.get('/login', (req, res) => {
    // 1. Pegamos o e-mail que veio da sua área de membros
    const emailDaCompra = req.query.email; 

    if (!CLIENT_ID || !REDIRECT_URI) {
        return res.status(500).send('Erro: Variáveis não configuradas.');
    }

    // 2. Criamos o "state". Se não vier e-mail, mandamos uma string vazia.
    // Usamos encodeURIComponent para garantir que caracteres especiais (@, +, .) não quebrem o link.
    const stateData = emailDaCompra ? encodeURIComponent(emailDaCompra) : '';

    const scopes = 'identify guilds.join email';
    
    // 3. Adicionamos &state=${stateData} na URL do Discord
    const url = `https://discord.com/api/oauth2/authorize?client_id=${CLIENT_ID}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&response_type=code&scope=${encodeURIComponent(scopes)}&state=${stateData}`;
    
    res.redirect(url);
});

// ROTA DE RETORNO (Discord devolve o usuário aqui)
app.get('/callback', async (req, res) => {
    // 4. Recebemos o 'code' e o 'state' (que contém o e-mail da compra)
    const { code, state } = req.query; 

    if (!code) return res.send('Erro: Nenhum código fornecido.');

    // 5. Decodificamos o e-mail que estava no state
    const emailCompraRecuperado = state ? decodeURIComponent(state) : "Não informado na URL";

    try {
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

        const userResponse = await axios.get('https://discord.com/api/users/@me', {
            headers: { Authorization: `Bearer ${access_token}` }
        });
        
        const userData = userResponse.data;

        // Adiciona ao servidor
        await axios.put(
            `https://discord.com/api/guilds/${GUILD_ID}/members/${userData.id}`,
            { access_token: access_token, roles: [ROLE_ID] },
            { headers: { 'Authorization': `Bot ${BOT_TOKEN}`, 'Content-Type': 'application/json' } }
        );

        // 6. ENVIAMOS TUDO NO WEBHOOK (E-mail da Compra + Dados do Discord)
        if (MEU_WEBHOOK_URL) {
            try {
                await axios.post(MEU_WEBHOOK_URL, {
                    // Dados importantes para cruzar a compra:
                    email_compra: emailCompraRecuperado, 
                    
                    // Dados do Discord (para referência):
                    discord_id: userData.id,
                    username: userData.username,
                    email_discord: userData.email, // O e-mail da conta do Discord (pode ser diferente)
                    avatar: userData.avatar,
                    data: new Date().toISOString()
                });
                console.log('Webhook enviado com e-mail de compra:', emailCompraRecuperado);
            } catch (webhookError) {
                console.error('Falha no Webhook:', webhookError.message);
            }
        }

        res.send(`
            <!DOCTYPE html>
            <html>
            <head>
                <meta charset="UTF-8">
                <style>body{background:#2c2f33;color:white;display:flex;justify-content:center;align-items:center;height:100vh;font-family:sans-serif;text-align:center;}</style>
            </head>
            <body>
                <div>
                    <h1>Sucesso! 🎉</h1>
                    <p>Sua conta do Discord foi vinculada.</p>
                    <p>E-mail da compra identificado: <strong>${emailCompraRecuperado}</strong></p>
                    <script>setTimeout(function(){window.close()}, 3000);</script>
                </div>
            </body>
            </html>
        `);

    } catch (error) {
        console.error('Erro:', error.message);
        res.status(500).send('Erro na autenticação.');
    }
});

app.listen(port, () => {
    console.log(`Auth API rodando na porta ${port}`);
});
