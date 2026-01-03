require('dotenv').config();
const express = require('express');
const axios = require('axios');
const { Client, GatewayIntentBits, ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType, PermissionsBitField, EmbedBuilder, ComponentType } = require('discord.js');

// --- INICIALIZAÇÕES ---
const app = express();
const port = process.env.PORT || 3000;

// Permite JSON (necessário para o Webhook de Ban)
app.use(express.json());

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.GuildMembers, 
    ]
});

// --- VARIÁVEIS DE AMBIENTE ---
const CLIENT_ID = process.env.CLIENT_ID;
const CLIENT_SECRET = process.env.CLIENT_SECRET;
const BOT_TOKEN = process.env.BOT_TOKEN;
const GUILD_ID = process.env.GUILD_ID;
const REDIRECT_URI = process.env.REDIRECT_URI; 
const ADMIN_SECRET = process.env.ADMIN_SECRET;

// Variáveis dos Cargos e Tickets
const CATEGORY_ID = process.env.CATEGORY_ID;         
const SUPPORT_ROLE_ID = process.env.SUPPORT_ROLE_ID; 
const ROLE_ID = process.env.ROLE_ID;                // Cargo Membro
const CLIENT_ROLE_ID = process.env.CLIENT_ROLE_ID;  // Cargo VIP
const TICKET_CHANNEL_ID = process.env.TICKET_CHANNEL_ID;

// Webhooks (n8n)
const WEBHOOK_AUTH_URL = process.env.MEU_WEBHOOK_URL;       
const WEBHOOK_VALIDACAO_URL = process.env.WEBHOOK_VALIDACAO_URL;

// =================================================================
//  PARTE 1: SERVIDOR WEB 
// =================================================================

app.get('/', (req, res) => {
    res.status(200).send('Bot Unificado Rodando 🚀');
});

// WEBHOOK DE BANIMENTO (Refund/Chargeback)
app.post('/webhook/ban', async (req, res) => {
    const { secret, discord_id, reason } = req.body;

    if (!ADMIN_SECRET || secret !== ADMIN_SECRET) {
        return res.status(403).json({ error: "Acesso Negado: Secret incorreto." });
    }

    if (!discord_id) return res.status(400).json({ error: "Faltando discord_id." });

    try {
        const guild = client.guilds.cache.get(GUILD_ID);
        if (!guild) return res.status(500).json({ error: "Guild não encontrada." });

        await guild.members.ban(discord_id, { reason: reason || 'Banimento automático (Refund)' });
        console.log(`🚫 USUÁRIO BANIDO: ID ${discord_id} | Motivo: ${reason}`);

        return res.json({ success: true, message: `Banido com sucesso.` });
    } catch (error) {
        console.error(`Erro ban:`, error);
        return res.status(500).json({ error: "Erro ao banir.", details: error.message });
    }
});

// ROTAS DE LOGIN
app.get('/login', (req, res) => {
    const emailDaCompra = req.query.email; 
    if (!CLIENT_ID || !REDIRECT_URI) return res.status(500).send('Erro: .env incompleto.');

    const stateData = emailDaCompra ? encodeURIComponent(emailDaCompra) : '';
    const scopes = 'identify guilds.join email';
    const url = `https://discord.com/api/oauth2/authorize?client_id=${CLIENT_ID}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&response_type=code&scope=${encodeURIComponent(scopes)}&state=${stateData}`;
    res.redirect(url);
});

app.get('/callback', async (req, res) => {
    const { code, state } = req.query; 
    if (!code) return res.send('Erro: Sem código do Discord.');

    const emailCompraRecuperado = state ? decodeURIComponent(state) : "Não informado";

    try {
        const params = new URLSearchParams({
            client_id: CLIENT_ID,
            client_secret: CLIENT_SECRET,
            grant_type: 'authorization_code',
            code,
            redirect_uri: REDIRECT_URI,
        });

        const tokenResponse = await axios.post('https://discord.com/api/oauth2/token', params, { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });
        const { access_token } = tokenResponse.data;

        const userResponse = await axios.get('https://discord.com/api/users/@me', { headers: { Authorization: `Bearer ${access_token}` } });
        const userData = userResponse.data;

        // Entrar no Servidor + Cargo Membro
        if (GUILD_ID) {
            try {
                await axios.put(
                    `https://discord.com/api/guilds/${GUILD_ID}/members/${userData.id}`,
                    { access_token: access_token }, 
                    { headers: { 'Authorization': `Bot ${BOT_TOKEN}`, 'Content-Type': 'application/json' } }
                );
            } catch (joinError) {}

            if (ROLE_ID) {
                try {
                    const guild = client.guilds.cache.get(GUILD_ID);
                    if (guild) {
                        const member = await guild.members.fetch(userData.id).catch(() => null);
                        if (member) await member.roles.add(ROLE_ID);
                    }
                } catch (roleError) { console.error('Erro ao dar cargo inicial.'); }
            }
        }

        // Webhook n8n
        if (WEBHOOK_AUTH_URL) {
            axios.post(WEBHOOK_AUTH_URL, {
                tipo: "LOGIN_SITE",
                email_compra: emailCompraRecuperado,
                discord_id: userData.id,
                username: userData.username,
                email_discord: userData.email,
                data: new Date().toISOString()
            }).catch(e => console.error('Erro webhook auth:', e.message));
        }

        // --- TELA DE SUCESSO COM REDIRECIONAMENTO ---
        // Link direto para o canal do servidor
        const discordRedirectUrl = `https://discord.com/channels/${GUILD_ID}`;
        
        res.send(`
            <!DOCTYPE html>
            <html lang="pt-BR">
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <title>Sucesso!</title>
                <style>
                    body { background-color: #2c2f33; color: white; font-family: sans-serif; display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100vh; margin: 0; }
                    .box { background: #23272a; padding: 40px; border-radius: 10px; text-align: center; box-shadow: 0 4px 15px rgba(0,0,0,0.3); max-width: 90%; }
                    h1 { color: #5865F2; margin-bottom: 10px; }
                    p { color: #b9bbbe; margin-bottom: 20px; }
                    .btn { background: #5865F2; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px; font-weight: bold; display: inline-block; margin-top: 10px; transition: background 0.2s; }
                    .btn:hover { background: #4752c4; }
                    .loader { border: 4px solid #f3f3f3; border-top: 4px solid #5865F2; border-radius: 50%; width: 20px; height: 20px; animation: spin 1s linear infinite; margin: 15px auto; }
                    @keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }
                </style>
            </head>
            <body>
                <div class="box">
                    <h1>Tudo certo! 🎉</h1>
                    <p>Sua conta foi vinculada com sucesso.</p>
                    
                    <div class="loader"></div>
                    <p style="font-size: 14px;">Levando você para o Discord...</p>
                    
                    <a href="${discordRedirectUrl}" class="btn">Abrir Discord Agora</a>
                </div>

                <script>
                    // Tenta redirecionar automaticamente após 3 segundos
                    setTimeout(function() {
                        window.location.href = "${discordRedirectUrl}";
                    }, 3000);
                </script>
            </body>
            </html>
        `);

    } catch (error) {
        console.error('Erro Callback:', error.message);
        res.status(500).send('Erro na autenticação. Tente novamente.');
    }
});

app.listen(port, () => {
    console.log(`🌍 Servidor Web rodando na porta ${port}`);
});


// =================================================================
//  PARTE 2: CLIENTE DISCORD 
// =================================================================

client.on('ready', async () => {
    console.log(`🤖 Bot Discord Logado: ${client.user.tag}`);
    
    if (TICKET_CHANNEL_ID) {
        const canalTickets = client.channels.cache.get(TICKET_CHANNEL_ID);
        if (canalTickets) {
            try {
                const ultimasMensagens = await canalTickets.messages.fetch({ limit: 1 });
                const ultimaMsg = ultimasMensagens.first();
                
                if (!ultimaMsg || ultimaMsg.author.id !== client.user.id) {
                    const embed = new EmbedBuilder().setColor('#0099ff').setTitle('Validação de Acesso VIP').setDescription('Clique abaixo para validar sua compra.');
                    const row = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('abrir_ticket').setLabel('Validar Compra').setEmoji('💎').setStyle(ButtonStyle.Success));
                    await canalTickets.send({ embeds: [embed], components: [row] });
                }
            } catch (e) { console.log('⚠️ Erro ao postar painel tickets:', e.message); }
        }
    }
});

client.on('interactionCreate', async (interaction) => {
    if (!interaction.isButton()) return;

    if (interaction.customId === 'abrir_ticket') {
        const nomeCanal = `ticket-${interaction.user.username.toLowerCase().replace(/[^a-z0-9]/g, '')}`;
        const jaTemTicket = interaction.guild.channels.cache.find(c => c.name === nomeCanal);
        if (jaTemTicket) return interaction.reply({ content: `⚠️ Você já tem um ticket: ${jaTemTicket}`, ephemeral: true });

        await interaction.deferReply({ ephemeral: true });

        try {
            const canal = await interaction.guild.channels.create({
                name: nomeCanal,
                type: ChannelType.GuildText,
                parent: CATEGORY_ID,
                permissionOverwrites: [
                    { id: interaction.guild.id, deny: [PermissionsBitField.Flags.ViewChannel] },
                    { id: interaction.user.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages] },
                    { id: SUPPORT_ROLE_ID, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages] },
                    { id: client.user.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages] }
                ]
            });

            await interaction.editReply({ content: `✅ Ticket criado: ${canal}` });
            const embed = new EmbedBuilder().setTitle(`Olá, ${interaction.user.username}`).setDescription('**Digite o E-MAIL usado na compra:**').setColor('#f1c40f');
            const btn = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('fechar_ticket').setLabel('Fechar').setStyle(ButtonStyle.Danger));
            await canal.send({ content: `<@${interaction.user.id}>`, embeds: [embed], components: [btn] });
            iniciarColetaDeEmail(canal, interaction.user);

        } catch (error) {
            console.error(error);
            await interaction.editReply('❌ Erro ao criar ticket. Verifique CATEGORY_ID.');
        }
    }

    if (interaction.customId === 'fechar_ticket') {
        await interaction.reply('Encerrando...');
        setTimeout(() => interaction.channel?.delete().catch(() => {}), 3000);
    }
});

function iniciarColetaDeEmail(canal, usuario) {
    const filter = m => m.author.id === usuario.id;
    const collector = canal.createMessageCollector({ filter, max: 1 });

    collector.on('collect', async (msg) => {
        const email = msg.content.trim();
        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('sim').setLabel('Confirmar').setStyle(ButtonStyle.Success),
            new ButtonBuilder().setCustomId('nao').setLabel('Corrigir').setStyle(ButtonStyle.Secondary)
        );

        const msgConf = await canal.send({ content: `E-mail: **${email}**. Confirma?`, components: [row] });
        const btnCol = msgConf.createMessageComponentCollector({ componentType: ComponentType.Button, time: 60000 });

        btnCol.on('collect', async (i) => {
            if (i.user.id !== usuario.id) return;
            if (i.customId === 'sim') {
                await i.update({ content: `🔄 Validando **${email}**...`, components: [] });
                try {
                    const resp = await axios.post(WEBHOOK_VALIDACAO_URL, { tipo: "VALIDACAO_TICKET", email: email, discord_id: usuario.id, username: usuario.username });
                    const texto = resp.data.reply || "Processado.";
                    const aprovado = resp.data.approved === true;
                    await canal.send({ embeds: [new EmbedBuilder().setDescription(texto).setColor(aprovado ? '#00FF00' : '#FF0000')] });
                    if (aprovado && CLIENT_ROLE_ID) {
                        try {
                            const member = await canal.guild.members.fetch(usuario.id);
                            await member.roles.add(CLIENT_ROLE_ID);
                            await canal.send(`🎉 Cargo <@&${CLIENT_ROLE_ID}> entregue!`);
                        } catch (e) { await canal.send(`⚠️ Erro cargo: ${e.message}`); }
                    }
                } catch (e) { await canal.send('❌ Erro de validação (API Offline).'); }
                btnCol.stop();
            } else {
                await i.update({ content: '⚠️ Digite o e-mail novamente:', components: [] });
                iniciarColetaDeEmail(canal, usuario);
                btnCol.stop();
            }
        });
    });
}

client.login(BOT_TOKEN);
