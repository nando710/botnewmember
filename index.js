require('dotenv').config();
const express = require('express');
const axios = require('axios');
const { Client, GatewayIntentBits, ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType, PermissionsBitField, EmbedBuilder, ComponentType } = require('discord.js');

// --- INICIALIZAÇÕES ---
const app = express();
const port = process.env.PORT || 3000;

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

const CATEGORY_ID = process.env.CATEGORY_ID;         
const SUPPORT_ROLE_ID = process.env.SUPPORT_ROLE_ID; 
const ROLE_ID = process.env.ROLE_ID;                // Cargo Membro (SERÁ REMOVIDO NO VIP)
const CLIENT_ROLE_ID = process.env.CLIENT_ROLE_ID;  // Cargo VIP
const TICKET_CHANNEL_ID = process.env.TICKET_CHANNEL_ID;

const WEBHOOK_AUTH_URL = process.env.MEU_WEBHOOK_URL;       
const WEBHOOK_VALIDACAO_URL = process.env.WEBHOOK_VALIDACAO_URL;

// =================================================================
//  PARTE 1: SERVIDOR WEB (Login + Banimento)
// =================================================================

app.get('/', (req, res) => res.status(200).send('Bot Rodando 🚀'));

// Rota de Revogação (Refund/Chargeback) - Remove Cargos ao invés de banir
app.post('/webhook/ban', async (req, res) => {
    const { secret, discord_id, reason } = req.body;
    if (!ADMIN_SECRET || secret !== ADMIN_SECRET) return res.status(403).json({ error: "Acesso Negado." });
    if (!discord_id) return res.status(400).json({ error: "Faltando discord_id." });

    try {
        const guild = client.guilds.cache.get(GUILD_ID);
        if (!guild) return res.status(500).json({ error: "Guild não encontrada." });

        // Busca o membro no servidor
        const member = await guild.members.fetch(discord_id).catch(() => null);

        if (!member) {
            return res.json({ success: false, message: `Usuário ${discord_id} não está no servidor (já saiu ou nunca entrou).` });
        }

        // Remove os cargos configurados (VIP e Membro)
        if (CLIENT_ROLE_ID) await member.roles.remove(CLIENT_ROLE_ID).catch(e => console.error(`Erro remove VIP: ${e.message}`));
        if (ROLE_ID) await member.roles.remove(ROLE_ID).catch(e => console.error(`Erro remove Membro: ${e.message}`));

        console.log(`📉 CARGOS REMOVIDOS: ID ${discord_id} | Motivo: ${reason}`);
        return res.json({ success: true, message: `Acesso revogado (Cargos removidos).` });

    } catch (error) {
        return res.status(500).json({ error: "Erro ao processar revogação.", details: error.message });
    }
});

// Rota Login
app.get('/login', (req, res) => {
    const emailDaCompra = req.query.email; 
    const stateData = emailDaCompra ? encodeURIComponent(emailDaCompra) : '';
    const scopes = 'identify guilds.join email';
    const url = `https://discord.com/api/oauth2/authorize?client_id=${CLIENT_ID}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&response_type=code&scope=${encodeURIComponent(scopes)}&state=${stateData}`;
    res.redirect(url);
});

// Rota Callback
app.get('/callback', async (req, res) => {
    const { code, state } = req.query; 
    if (!code) return res.send('Erro: Sem código.');
    const emailCompra = state ? decodeURIComponent(state) : "Não informado";

    try {
        const params = new URLSearchParams({ client_id: CLIENT_ID, client_secret: CLIENT_SECRET, grant_type: 'authorization_code', code, redirect_uri: REDIRECT_URI });
        const tokenResponse = await axios.post('https://discord.com/api/oauth2/token', params, { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });
        const { access_token } = tokenResponse.data;
        const userResponse = await axios.get('https://discord.com/api/users/@me', { headers: { Authorization: `Bearer ${access_token}` } });
        const userData = userResponse.data;

        if (GUILD_ID) {
            try {
                await axios.put(`https://discord.com/api/guilds/${GUILD_ID}/members/${userData.id}`, { access_token }, { headers: { 'Authorization': `Bot ${BOT_TOKEN}`, 'Content-Type': 'application/json' } });
            } catch (e) {}
            if (ROLE_ID) {
                try {
                    const guild = client.guilds.cache.get(GUILD_ID);
                    if (guild) {
                        const member = await guild.members.fetch(userData.id).catch(() => null);
                        if (member) await member.roles.add(ROLE_ID);
                    }
                } catch (e) {}
            }
        }

        if (WEBHOOK_AUTH_URL) axios.post(WEBHOOK_AUTH_URL, { tipo: "LOGIN_SITE", email_compra: emailCompra, discord_id: userData.id, username: userData.username, email_discord: userData.email, data: new Date().toISOString() }).catch(() => {});

        const discordRedirectUrl = `https://discord.com/channels/${GUILD_ID}`;
        res.send(`<!DOCTYPE html><html><head><meta charset="UTF-8"><meta http-equiv="refresh" content="3;url=${discordRedirectUrl}"></head><body style="background:#2c2f33;color:white;display:flex;justify-content:center;align-items:center;height:100vh;font-family:sans-serif;text-align:center;"><div><h1>Sucesso! 🎉</h1><p>Redirecionando para o Discord...</p></div></body></html>`);

    } catch (error) { res.status(500).send('Erro na autenticação.'); }
});

app.listen(port, () => console.log(`🌍 Rodando na porta ${port}`));

// =================================================================
//  PARTE 2: TICKETS DISCORD (COM NOVAS REGRAS)
// =================================================================

client.on('ready', async () => {
    console.log(`🤖 Logado como ${client.user.tag}`);
    if (TICKET_CHANNEL_ID) {
        const canalTickets = client.channels.cache.get(TICKET_CHANNEL_ID);
        if (canalTickets) {
            try {
                const msgs = await canalTickets.messages.fetch({ limit: 1 });
                if (!msgs.first() || msgs.first().author.id !== client.user.id) {
                    const row = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('abrir_ticket').setLabel('Validar Compra').setEmoji('💎').setStyle(ButtonStyle.Success));
                    await canalTickets.send({ embeds: [new EmbedBuilder().setColor('#0099ff').setTitle('Validação VIP').setDescription('Clique abaixo para validar.')], components: [row] });
                }
            } catch (e) {}
        }
    }
});

client.on('interactionCreate', async (interaction) => {
    if (!interaction.isButton()) return;

    if (interaction.customId === 'abrir_ticket') {
        const nomeCanal = `ticket-${interaction.user.username.toLowerCase().replace(/[^a-z0-9]/g, '')}`;
        const jaTem = interaction.guild.channels.cache.find(c => c.name === nomeCanal);
        if (jaTem) return interaction.reply({ content: `⚠️ Ticket já aberto: ${jaTem}`, ephemeral: true });

        await interaction.deferReply({ ephemeral: true });

        try {
            const canal = await interaction.guild.channels.create({
                name: nomeCanal, type: ChannelType.GuildText, parent: CATEGORY_ID,
                permissionOverwrites: [
                    { id: interaction.guild.id, deny: [PermissionsBitField.Flags.ViewChannel] },
                    { id: interaction.user.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages] },
                    { id: SUPPORT_ROLE_ID, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages] },
                    { id: client.user.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages] }
                ]
            });
            await interaction.editReply({ content: `✅ Ticket: ${canal}` });
            
            const btn = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('fechar_ticket').setLabel('Cancelar').setStyle(ButtonStyle.Danger));
            await canal.send({ content: `<@${interaction.user.id}>`, embeds: [new EmbedBuilder().setTitle(`Olá, ${interaction.user.username}`).setDescription('**Digite o E-MAIL da compra:**').setColor('#f1c40f')], components: [btn] });
            
            iniciarColetaDeEmail(canal, interaction.user);

        } catch (e) { await interaction.editReply('❌ Erro ao criar ticket.'); }
    }

    if (interaction.customId === 'fechar_ticket') {
        await interaction.reply('Fechando em 3s...');
        setTimeout(() => interaction.channel?.delete().catch(() => {}), 3000);
    }
});

// --- FUNÇÃO PRINCIPAL COM AS NOVAS REGRAS ---
function iniciarColetaDeEmail(canal, usuario) {
    // 1. Coletor de Mensagem (E-mail) com Timeout de 2 min
    const filter = m => m.author.id === usuario.id;
    const collector = canal.createMessageCollector({ filter, max: 1, time: 120000 }); // 120.000ms = 2 minutos

    collector.on('collect', async (msg) => {
        const email = msg.content.trim();
        
        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('sim').setLabel('Confirmar').setStyle(ButtonStyle.Success),
            new ButtonBuilder().setCustomId('nao').setLabel('Corrigir').setStyle(ButtonStyle.Secondary)
        );

        const msgConf = await canal.send({ content: `E-mail: **${email}**. Confirma?`, components: [row] });
        
        // 2. Coletor de Botões com Timeout de 2 min
        const btnCol = msgConf.createMessageComponentCollector({ componentType: ComponentType.Button, time: 120000 });

        btnCol.on('collect', async (i) => {
            if (i.user.id !== usuario.id) return;

            if (i.customId === 'sim') {
                await i.update({ content: `🔄 Validando **${email}**...`, components: [] });
                
                try {
                    const resp = await axios.post(WEBHOOK_VALIDACAO_URL, { tipo: "VALIDACAO_TICKET", email: email, discord_id: usuario.id, username: usuario.username });
                    const aprovado = resp.data.approved === true;
                    const texto = resp.data.reply || (aprovado ? "Acesso Liberado!" : "E-mail não encontrado ou compra reembolsada.");

                    await canal.send({ embeds: [new EmbedBuilder().setDescription(texto).setColor(aprovado ? '#00FF00' : '#FF0000')] });

                    if (aprovado) {
                        // === REGRA: ENTREGAR VIP E REMOVER MEMBRO COMUM ===
                        if (CLIENT_ROLE_ID) {
                            try {
                                const member = await canal.guild.members.fetch(usuario.id);
                                await member.roles.add(CLIENT_ROLE_ID);
                                // Remove o cargo antigo se existir
                                if (ROLE_ID) await member.roles.remove(ROLE_ID).catch(e => console.log('Erro ao remover cargo antigo:', e.message));
                                
                                await canal.send(`🎉 **Sucesso!** Cargo VIP entregue e cargo Membro removido.`);
                                
                                // Opcional: Fechar ticket automaticamente após sucesso
                                setTimeout(() => canal.send("Este ticket será fechado em 5 segundos..."), 2000);
                                setTimeout(() => canal.delete().catch(() => {}), 7000);
                            } catch (e) { await canal.send(`⚠️ Erro na troca de cargos: ${e.message}`); }
                        }
                    } else {
                        // === REGRA: TENTAR OUTRO E-MAIL ===
                        const rowRetry = new ActionRowBuilder().addComponents(
                            new ButtonBuilder().setCustomId('tentar_dnv').setLabel('Tentar Outro E-mail').setStyle(ButtonStyle.Primary),
                            new ButtonBuilder().setCustomId('fechar_ticket').setLabel('Cancelar').setStyle(ButtonStyle.Danger)
                        );
                        
                        const msgRetry = await canal.send({ content: "❌ Validação falhou. Deseja tentar com outro e-mail?", components: [rowRetry] });
                        
                        // Pequeno coletor para decidir se tenta de novo
                        const retryCol = msgRetry.createMessageComponentCollector({ componentType: ComponentType.Button, time: 60000 });
                        
                        retryCol.on('collect', async (intRetry) => {
                            if (intRetry.user.id !== usuario.id) return;
                            if (intRetry.customId === 'tentar_dnv') {
                                await intRetry.update({ content: "🔄 Ok, digite o novo e-mail abaixo:", components: [] });
                                iniciarColetaDeEmail(canal, usuario); // RECURSIVIDADE: Chama a função de novo
                                retryCol.stop();
                            } else if (intRetry.customId === 'fechar_ticket') {
                                await intRetry.reply("Fechando...");
                                setTimeout(() => canal.delete().catch(() => {}), 2000);
                            }
                        });
                    }
                } catch (e) { 
                    await canal.send('❌ Erro de conexão com o servidor de validação.'); 
                }
                btnCol.stop();

            } else if (i.customId === 'nao') {
                await i.update({ content: '⚠️ Digite o e-mail novamente:', components: [] });
                iniciarColetaDeEmail(canal, usuario); // Tenta de novo (correção)
                btnCol.stop();
            }
        });

        // Timeout do Coletor de Botões
        btnCol.on('end', (c, reason) => {
            if (reason === 'time') {
                tratarInatividade(canal);
            }
        });
    });

    // Timeout do Coletor de Mensagem (se ele não digitar nada em 2 min)
    collector.on('end', (collected, reason) => {
        if (reason === 'time') {
            tratarInatividade(canal);
        }
    });
}

// Função auxiliar para fechar ticket por inatividade
function tratarInatividade(canal) {
    // Verifica se o canal ainda existe antes de tentar enviar msg
    if (canal) {
        canal.send('⚠️ **Tempo esgotado.** O atendimento foi encerrado por inatividade (2 minutos). Fechando ticket...').catch(() => {});
        setTimeout(() => canal.delete().catch(() => {}), 5000);
    }
}

client.login(BOT_TOKEN);
