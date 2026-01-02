require('dotenv').config();
const express = require('express');
const axios = require('axios');
const { Client, GatewayIntentBits, ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType, PermissionsBitField, EmbedBuilder, ComponentType } = require('discord.js');

// --- INICIALIZAÇÕES ---
const app = express();
const port = process.env.PORT || 3000;

// IMPORTANTE: Permite que o Express leia JSON (Necessário para o Webhook de Ban)
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
const ADMIN_SECRET = process.env.ADMIN_SECRET; // <--- NOVA VARIÁVEL (Senha para Banir)

// Variáveis dos Cargos e Tickets
const CATEGORY_ID = process.env.CATEGORY_ID;         
const SUPPORT_ROLE_ID = process.env.SUPPORT_ROLE_ID; 
const ROLE_ID = process.env.ROLE_ID;                // Cargo 1: Membro
const CLIENT_ROLE_ID = process.env.CLIENT_ROLE_ID;  // Cargo 2: VIP
const TICKET_CHANNEL_ID = process.env.TICKET_CHANNEL_ID;

// Webhooks (n8n)
const WEBHOOK_AUTH_URL = process.env.MEU_WEBHOOK_URL;       
const WEBHOOK_VALIDACAO_URL = process.env.WEBHOOK_VALIDACAO_URL;

// =================================================================
//  PARTE 1: SERVIDOR WEB 
// =================================================================

app.get('/', (req, res) => {
    res.status(200).send('Bot Unificado (Web + Discord + Ban System) rodando! 🚀');
});

// -----------------------------------------------------------------
//  NOVA ROTA: WEBHOOK DE BANIMENTO (Refund/Chargeback)
// -----------------------------------------------------------------
// Como usar no n8n (HTTP Request):
// Method: POST
// URL: https://seu-bot.com/webhook/ban
// Body: { "secret": "SUA_SENHA_ADMIN", "discord_id": "123456789", "reason": "Chargeback Hotmart" }

app.post('/webhook/ban', async (req, res) => {
    const { secret, discord_id, reason } = req.body;

    // 1. Verificação de Segurança
    if (!ADMIN_SECRET || secret !== ADMIN_SECRET) {
        return res.status(403).json({ error: "Acesso Negado: Secret incorreto ou não configurado." });
    }

    if (!discord_id) {
        return res.status(400).json({ error: "Faltando discord_id." });
    }

    try {
        const guild = client.guilds.cache.get(GUILD_ID);
        if (!guild) return res.status(500).json({ error: "Servidor (Guild) não encontrado no cache do Bot." });

        // Tenta buscar o membro para ver se ele está no servidor (opcional, pois ban funciona com ID mesmo fora)
        // O ban aceita apenas o ID direto
        await guild.members.ban(discord_id, { reason: reason || 'Banimento automático via Webhook (Refund/Chargeback)' });

        console.log(`🚫 USUÁRIO BANIDO: ID ${discord_id} | Motivo: ${reason}`);

        // Opcional: Tentar enviar uma DM antes de banir (Muitas vezes falha se o usuário tiver DMs fechadas)
        /* try {
            const user = await client.users.fetch(discord_id);
            await user.send(`Você foi banido por inconsistência no pagamento (Refund/Chargeback).`).catch(() => {});
        } catch(e) {} 
        */

        return res.json({ success: true, message: `Usuário ${discord_id} foi banido com sucesso.` });

    } catch (error) {
        console.error(`Erro ao banir ${discord_id}:`, error);
        return res.status(500).json({ error: "Erro ao executar o banimento.", details: error.message });
    }
});

// -----------------------------------------------------------------
//  ROTAS DE LOGIN (OAuth2)
// -----------------------------------------------------------------

app.get('/login', (req, res) => {
    const emailDaCompra = req.query.email; 
    if (!CLIENT_ID || !REDIRECT_URI) return res.status(500).send('Erro: Variáveis de ambiente não configuradas.');

    const stateData = emailDaCompra ? encodeURIComponent(emailDaCompra) : '';
    const scopes = 'identify guilds.join email';
    const url = `https://discord.com/api/oauth2/authorize?client_id=${CLIENT_ID}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&response_type=code&scope=${encodeURIComponent(scopes)}&state=${stateData}`;
    res.redirect(url);
});

app.get('/callback', async (req, res) => {
    const { code, state } = req.query; 
    if (!code) return res.send('Erro: O Discord não retornou um código.');

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

        if (GUILD_ID) {
            try {
                await axios.put(
                    `https://discord.com/api/guilds/${GUILD_ID}/members/${userData.id}`,
                    { access_token: access_token }, 
                    { headers: { 'Authorization': `Bot ${BOT_TOKEN}`, 'Content-Type': 'application/json' } }
                );
            } catch (joinError) {
                console.log(`Log Join: Usuário já estava no servidor ou erro na API.`);
            }

            if (ROLE_ID) {
                try {
                    const guild = client.guilds.cache.get(GUILD_ID);
                    if (guild) {
                        const member = await guild.members.fetch(userData.id).catch(() => null);
                        if (member) await member.roles.add(ROLE_ID);
                    }
                } catch (roleError) {
                    console.error(`❌ ERRO DE PERMISSÃO: Verifique a hierarquia de cargos.`);
                }
            }
        }

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

        res.send(`
            <!DOCTYPE html>
            <html lang="pt-BR">
            <head><meta charset="UTF-8"><style>body{background:#2c2f33;color:white;display:flex;justify-content:center;align-items:center;height:100vh;font-family:sans-serif;} .box{background:#23272a;padding:40px;border-radius:10px;text-align:center;}</style></head>
            <body><div class="box"><h1>Sucesso! 🎉</h1><p>Sua conta foi vinculada.</p><script>setTimeout(()=>window.close(), 3000)</script></div></body>
            </html>
        `);

    } catch (error) {
        console.error('Erro Callback:', error.message);
        res.status(500).send('Erro na autenticação.');
    }
});

app.listen(port, () => {
    console.log(`🌍 Servidor Web rodando na porta ${port}`);
});

// =================================================================
//  PARTE 2: CLIENTE DISCORD (TICKETS)
// =================================================================

client.on('ready', async () => {
    console.log(`🤖 Bot Discord Logado: ${client.user.tag}`);
    
    // Auto-Postar Botão (Se configurado)
    if (TICKET_CHANNEL_ID) {
        const canalTickets = client.channels.cache.get(TICKET_CHANNEL_ID);
        if (canalTickets) {
            try {
                // Para evitar flood toda vez que reinicia, vamos buscar as últimas mensagens
                // Se a última mensagem for do bot, não manda de novo.
                const ultimasMensagens = await canalTickets.messages.fetch({ limit: 1 });
                const ultimaMsg = ultimasMensagens.first();
                
                if (!ultimaMsg || ultimaMsg.author.id !== client.user.id) {
                    // Limpa (opcional) ou só posta
                    // await canalTickets.bulkDelete(5).catch(() => {}); 
                    
                    const embed = new EmbedBuilder()
                        .setColor('#0099ff')
                        .setTitle('Validação de Acesso VIP')
                        .setDescription('Clique abaixo para validar sua compra.');
                    
                    const row = new ActionRowBuilder().addComponents(
                        new ButtonBuilder().setCustomId('abrir_ticket').setLabel('Validar Compra').setEmoji('💎').setStyle(ButtonStyle.Success)
                    );
                    await canalTickets.send({ embeds: [embed], components: [row] });
                    console.log('✅ Painel de Tickets postado.');
                }
            } catch (e) { console.log('⚠️ Erro ao postar painel:', e.message); }
        }
    }
});

client.on('interactionCreate', async (interaction) => {
    if (!interaction.isButton()) return;

    if (interaction.customId === 'abrir_ticket') {
        const nomeCanal = `ticket-${interaction.user.username.toLowerCase().replace(/[^a-z0-9]/g, '')}`;
        const jaTemTicket = interaction.guild.channels.cache.find(c => c.name === nomeCanal);
        
        if (jaTemTicket) return interaction.reply({ content: `⚠️ Você já tem um atendimento aberto: ${jaTemTicket}`, ephemeral: true });

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
            await interaction.editReply('❌ Erro ao criar ticket.');
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
                    const resp = await axios.post(WEBHOOK_VALIDACAO_URL, {
                        tipo: "VALIDACAO_TICKET",
                        email: email,
                        discord_id: usuario.id,
                        username: usuario.username
                    });
                    
                    const texto = resp.data.reply || "Processado.";
                    const aprovado = resp.data.approved === true;
                    
                    await canal.send({ embeds: [new EmbedBuilder().setDescription(texto).setColor(aprovado ? '#00FF00' : '#FF0000')] });

                    if (aprovado && CLIENT_ROLE_ID) {
                        try {
                            const member = await canal.guild.members.fetch(usuario.id);
                            await member.roles.add(CLIENT_ROLE_ID);
                            await canal.send(`🎉 Cargo <@&${CLIENT_ROLE_ID}> entregue!`);
                        } catch (e) { await canal.send(`⚠️ Erro ao dar cargo: ${e.message}`); }
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
