require('dotenv').config();
const express = require('express');
const axios = require('axios');
const { Client, GatewayIntentBits, ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType, PermissionsBitField, EmbedBuilder, ComponentType } = require('discord.js');

// --- INICIALIZAÇÕES ---
const app = express();
const port = process.env.PORT || 3000;

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

// Variáveis do Sistema de Tickets
const CATEGORY_ID = process.env.CATEGORY_ID;         
const SUPPORT_ROLE_ID = process.env.SUPPORT_ROLE_ID; 
const CLIENT_ROLE_ID = process.env.CLIENT_ROLE_ID; 
const TICKET_CHANNEL_ID = process.env.TICKET_CHANNEL_ID;

// Webhooks
const WEBHOOK_AUTH_URL = process.env.MEU_WEBHOOK_URL; // Login do Site
const WEBHOOK_VALIDACAO_URL = process.env.WEBHOOK_VALIDACAO_URL; // Validação do Ticket

// =================================================================
//  PARTE 1: SERVIDOR WEB (AUTENTICAÇÃO / LOGIN DO SITE)
// =================================================================

app.get('/', (req, res) => {
    res.status(200).send('Bot Unificado (Web + Discord) rodando! 🚀');
});

// Rota de Login
app.get('/login', (req, res) => {
    const emailDaCompra = req.query.email; 
    if (!CLIENT_ID || !REDIRECT_URI) return res.status(500).send('Erro: Variáveis de ambiente não configuradas.');

    const stateData = emailDaCompra ? encodeURIComponent(emailDaCompra) : '';
    const scopes = 'identify guilds.join email';
    
    // URL de autorização do Discord
    const url = `https://discord.com/api/oauth2/authorize?client_id=${CLIENT_ID}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&response_type=code&scope=${encodeURIComponent(scopes)}&state=${stateData}`;
    
    res.redirect(url);
});

// Rota de Callback
app.get('/callback', async (req, res) => {
    const { code, state } = req.query; 
    if (!code) return res.send('Erro: O Discord não retornou um código.');

    const emailCompraRecuperado = state ? decodeURIComponent(state) : "Não informado";

    try {
        // Troca Code por Token
        const params = new URLSearchParams({
            client_id: CLIENT_ID,
            client_secret: CLIENT_SECRET,
            grant_type: 'authorization_code',
            code,
            redirect_uri: REDIRECT_URI,
        });

        const tokenResponse = await axios.post('https://discord.com/api/oauth2/token', params, { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });
        const { access_token } = tokenResponse.data;

        // Pega dados do User
        const userResponse = await axios.get('https://discord.com/api/users/@me', { headers: { Authorization: `Bearer ${access_token}` } });
        const userData = userResponse.data;

        // Adiciona ao Servidor
        if (GUILD_ID) {
            try {
                await axios.put(
                    `https://discord.com/api/guilds/${GUILD_ID}/members/${userData.id}`,
                    { access_token: access_token }, 
                    { headers: { 'Authorization': `Bot ${BOT_TOKEN}`, 'Content-Type': 'application/json' } }
                );
            } catch (e) { console.error('Erro ao adicionar membro (verifique hierarquia de cargos):', e.message); }
        }

        // Webhook de Notificação (Login do Site)
        if (WEBHOOK_AUTH_URL) {
            axios.post(WEBHOOK_AUTH_URL, {
                tipo: "LOGIN_SITE",
                email_compra: emailCompraRecuperado,
                discord_id: userData.id,
                username: userData.username,
                email_discord: userData.email,
                data: new Date().toISOString()
            }).catch(e => console.error('Erro Webhook Auth:', e.message));
        }

        // HTML de Sucesso
        res.send(`
            <!DOCTYPE html>
            <html lang="pt-BR">
            <head>
                <meta charset="UTF-8">
                <style>body{background:#2c2f33;color:white;display:flex;justify-content:center;align-items:center;height:100vh;font-family:sans-serif;text-align:center;} .box{background:#23272a;padding:40px;border-radius:10px;}</style>
            </head>
            <body>
                <div class="box">
                    <h1>Conectado! 🎉</h1>
                    <p>Sua conta do Discord foi vinculada.</p>
                    <p style="color:#00b0f4">Email da compra: ${emailCompraRecuperado}</p>
                    <script>setTimeout(()=>window.close(), 3000)</script>
                </div>
            </body>
            </html>
        `);

    } catch (error) {
        console.error('Erro Callback:', error.message);
        res.status(500).send('Erro na autenticação. Verifique os logs.');
    }
});

app.listen(port, () => {
    console.log(`🌍 Servidor Web rodando na porta ${port}`);
});


// =================================================================
//  PARTE 2: CLIENTE DISCORD (SISTEMA DE TICKETS)
// =================================================================

client.on('ready', async () => {
    console.log(`🤖 Bot Discord Logado: ${client.user.tag}`);

    // Auto-Postar Botão de Ticket
    if (TICKET_CHANNEL_ID) {
        const canalTickets = client.channels.cache.get(TICKET_CHANNEL_ID);
        if (canalTickets) {
            try {
                await canalTickets.bulkDelete(5).catch(() => {});
                const embed = new EmbedBuilder()
                    .setColor('#0099ff')
                    .setTitle('Validação de Acesso')
                    .setDescription('**Já comprou e quer liberar seu acesso VIP?**\nClique no botão abaixo para iniciar a validação.');
                
                const row = new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId('abrir_ticket').setLabel('Validar Minha Compra').setEmoji('💎').setStyle(ButtonStyle.Success)
                );
                await canalTickets.send({ embeds: [embed], components: [row] });
                console.log('✅ Painel de Tickets atualizado.');
            } catch (e) { console.log('Erro ao postar painel (Bot sem permissão de ver canal ou apagar mensagens).'); }
        }
    }
});

client.on('interactionCreate', async (interaction) => {
    if (!interaction.isButton()) return;

    // --- ABRIR TICKET ---
    if (interaction.customId === 'abrir_ticket') {
        const jaTemTicket = interaction.guild.channels.cache.find(c => c.name === `ticket-${interaction.user.username.toLowerCase().replace(/[^a-z0-9]/g, '')}`);
        if (jaTemTicket) return interaction.reply({ content: `⚠️ Você já tem um atendimento aberto: ${jaTemTicket}`, ephemeral: true });

        await interaction.deferReply({ ephemeral: true });

        try {
            const canal = await interaction.guild.channels.create({
                name: `ticket-${interaction.user.username}`,
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

            const embedBoasVindas = new EmbedBuilder()
                .setColor('#f1c40f')
                .setTitle(`Olá, ${interaction.user.username}`)
                .setDescription('**Por favor, digite aqui o E-MAIL que você usou na compra.**');

            const btnFechar = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId('fechar_ticket').setLabel('Cancelar').setStyle(ButtonStyle.Danger)
            );

            await canal.send({ content: `<@${interaction.user.id}>`, embeds: [embedBoasVindas], components: [btnFechar] });
            iniciarColetaDeEmail(canal, interaction.user);

        } catch (error) {
            console.error(error);
            await interaction.editReply('❌ Erro ao criar ticket. Verifique se o ID da Categoria está correto.');
        }
    }

    // --- FECHAR TICKET ---
    if (interaction.customId === 'fechar_ticket') {
        await interaction.reply('Encerrando...');
        setTimeout(() => interaction.channel?.delete().catch(() => {}), 3000);
    }
});

// Função Auxiliar de Coleta
function iniciarColetaDeEmail(canal, usuario) {
    const filter = m => m.author.id === usuario.id;
    const collector = canal.createMessageCollector({ filter, max: 1 });

    collector.on('collect', async (msg) => {
        const email = msg.content;
        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('sim').setLabel('Confirmar').setStyle(ButtonStyle.Success),
            new ButtonBuilder().setCustomId('nao').setLabel('Corrigir').setStyle(ButtonStyle.Secondary)
        );

        const msgConf = await canal.send({ content: `Você digitou: **${email}**. Confirma?`, components: [row] });
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
                        const member = await canal.guild.members.fetch(usuario.id);
                        await member.roles.add(CLIENT_ROLE_ID).catch(e => canal.send(`Erro ao dar cargo: Verifique a hierarquia.`));
                        await canal.send(`🎉 Cargo <@&${CLIENT_ROLE_ID}> entregue com sucesso!`);
                    }
                } catch (e) { await canal.send('❌ Erro na validação (Servidor n8n offline ou erro 500).'); }
                btnCol.stop();
            } else {
                await i.update({ content: '⚠️ Digite novamente:', components: [] });
                iniciarColetaDeEmail(canal, usuario);
                btnCol.stop();
            }
        });
    });
}

client.login(BOT_TOKEN);
