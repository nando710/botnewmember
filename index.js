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
        GatewayIntentBits.GuildMembers, // <--- ESSENCIAL PARA DAR CARGOS
    ]
});

// --- VARIÁVEIS DE AMBIENTE ---
const CLIENT_ID = process.env.CLIENT_ID;
const CLIENT_SECRET = process.env.CLIENT_SECRET;
const BOT_TOKEN = process.env.BOT_TOKEN;
const GUILD_ID = process.env.GUILD_ID;
const REDIRECT_URI = process.env.REDIRECT_URI; 

// Variáveis dos Cargos e Tickets
const CATEGORY_ID = process.env.CATEGORY_ID;         
const SUPPORT_ROLE_ID = process.env.SUPPORT_ROLE_ID; 
const ROLE_ID = process.env.ROLE_ID;               // Cargo 1: Membro (Login Site)
const CLIENT_ROLE_ID = process.env.CLIENT_ROLE_ID; // Cargo 2: VIP (Ticket Aprovado)
const TICKET_CHANNEL_ID = process.env.TICKET_CHANNEL_ID;

// Webhooks (n8n)
const WEBHOOK_AUTH_URL = process.env.MEU_WEBHOOK_URL;       // Login do Site
const WEBHOOK_VALIDACAO_URL = process.env.WEBHOOK_VALIDACAO_URL; // Validação do Ticket

// =================================================================
//  PARTE 1: SERVIDOR WEB (AUTENTICAÇÃO / LOGIN DO SITE)
// =================================================================

app.get('/', (req, res) => {
    res.status(200).send('Bot Unificado (Web + Discord) rodando! 🚀');
});

// Rota de Login (Recebe ?email=cliente@gmail.com)
app.get('/login', (req, res) => {
    const emailDaCompra = req.query.email; 
    
    if (!CLIENT_ID || !REDIRECT_URI) return res.status(500).send('Erro: Variáveis de ambiente (CLIENT_ID/REDIRECT_URI) não configuradas.');

    // Passa o e-mail no parâmetro STATE para recuperar depois
    const stateData = emailDaCompra ? encodeURIComponent(emailDaCompra) : '';
    const scopes = 'identify guilds.join email';
    
    const url = `https://discord.com/api/oauth2/authorize?client_id=${CLIENT_ID}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&response_type=code&scope=${encodeURIComponent(scopes)}&state=${stateData}`;
    
    res.redirect(url);
});

// Rota de Callback (Retorno do Discord)
app.get('/callback', async (req, res) => {
    const { code, state } = req.query; 
    if (!code) return res.send('Erro: O Discord não retornou um código.');

    const emailCompraRecuperado = state ? decodeURIComponent(state) : "Não informado";

    try {
        // 1. Troca Code por Token de Acesso
        const params = new URLSearchParams({
            client_id: CLIENT_ID,
            client_secret: CLIENT_SECRET,
            grant_type: 'authorization_code',
            code,
            redirect_uri: REDIRECT_URI,
        });

        const tokenResponse = await axios.post('https://discord.com/api/oauth2/token', params, { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });
        const { access_token } = tokenResponse.data;

        // 2. Pega dados do Usuário
        const userResponse = await axios.get('https://discord.com/api/users/@me', { headers: { Authorization: `Bearer ${access_token}` } });
        const userData = userResponse.data;

        // 3. ADICIONA AO SERVIDOR E DÁ O CARGO DE MEMBRO (Lógica Blindada)
        if (GUILD_ID) {
            // Passo A: Tenta fazer o Join via API REST (Necessário se o usuário não for membro)
            try {
                await axios.put(
                    `https://discord.com/api/guilds/${GUILD_ID}/members/${userData.id}`,
                    { access_token: access_token }, 
                    { headers: { 'Authorization': `Bot ${BOT_TOKEN}`, 'Content-Type': 'application/json' } }
                );
            } catch (joinError) {
                // Se der erro aqui, geralmente é porque o usuário já está no servidor. Seguimos o baile.
                console.log(`Log Join: Usuário ${userData.username} já estava no servidor ou erro na API REST.`);
            }

            // Passo B: Força a entrega do Cargo usando o Cliente Discord (Mais confiável)
            if (ROLE_ID) {
                try {
                    const guild = client.guilds.cache.get(GUILD_ID);
                    if (guild) {
                        // Espera um pouco para garantir que o discord processou a entrada
                        const member = await guild.members.fetch(userData.id).catch(() => null);
                        
                        if (member) {
                            await member.roles.add(ROLE_ID);
                            console.log(`✅ Cargo de Entrada (${ROLE_ID}) entregue para ${userData.username}.`);
                        } else {
                            console.error(`⚠️ Não consegui encontrar o membro ${userData.username} no cache do servidor para dar cargo.`);
                        }
                    }
                } catch (roleError) {
                    console.error(`❌ ERRO DE PERMISSÃO: Verifique se o cargo do Bot está ACIMA do cargo ${ROLE_ID} na lista de cargos.`);
                }
            }
        }

        // 4. Envia Webhook para o n8n (Registro)
        if (WEBHOOK_AUTH_URL) {
            axios.post(WEBHOOK_AUTH_URL, {
                tipo: "LOGIN_SITE",
                email_compra: emailCompraRecuperado,
                discord_id: userData.id,
                username: userData.username,
                email_discord: userData.email,
                data: new Date().toISOString()
            }).catch(e => console.error('Erro ao enviar Webhook Auth:', e.message));
        }

        // 5. Tela de Sucesso
        res.send(`
            <!DOCTYPE html>
            <html lang="pt-BR">
            <head>
                <meta charset="UTF-8">
                <style>body{background:#2c2f33;color:white;display:flex;justify-content:center;align-items:center;height:100vh;font-family:sans-serif;text-align:center;} .box{background:#23272a;padding:40px;border-radius:10px;box-shadow: 0 4px 15px rgba(0,0,0,0.3);}</style>
            </head>
            <body>
                <div class="box">
                    <h1>Sucesso! 🎉</h1>
                    <p>Sua conta do Discord foi vinculada.</p>
                    <p style="color:#00b0f4; font-family:monospace">Email identificado: ${emailCompraRecuperado}</p>
                    <p><small>Você já pode fechar esta janela.</small></p>
                    <script>setTimeout(()=>window.close(), 5000)</script>
                </div>
            </body>
            </html>
        `);

    } catch (error) {
        console.error('Erro Crítico no Callback:', error.message);
        res.status(500).send('Erro na autenticação. Tente novamente.');
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

    // Auto-Postar Botão de Ticket no Canal Configurado
    if (TICKET_CHANNEL_ID) {
        const canalTickets = client.channels.cache.get(TICKET_CHANNEL_ID);
        if (canalTickets) {
            try {
                // Limpa mensagens antigas para não floodar
                await canalTickets.bulkDelete(5).catch(() => {});
                
                const embed = new EmbedBuilder()
                    .setColor('#0099ff')
                    .setTitle('Validação de Acesso VIP')
                    .setDescription('**Já fez sua compra e quer liberar o acesso VIP?**\nClique no botão abaixo para iniciar a validação automática.');
                
                const row = new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId('abrir_ticket').setLabel('Validar Minha Compra').setEmoji('💎').setStyle(ButtonStyle.Success)
                );
                await canalTickets.send({ embeds: [embed], components: [row] });
                console.log('✅ Painel de Tickets atualizado com sucesso.');
            } catch (e) { console.log('⚠️ Erro ao postar painel: Verifique se o Bot tem permissão de "Ver Canal" e "Gerenciar Mensagens" neste canal.'); }
        } else {
            console.log('⚠️ Canal de Tickets não encontrado. Verifique o ID no .env');
        }
    }
});

client.on('interactionCreate', async (interaction) => {
    if (!interaction.isButton()) return;

    // --- ABRIR TICKET ---
    if (interaction.customId === 'abrir_ticket') {
        // Verifica se já tem ticket aberto
        const nomeCanal = `ticket-${interaction.user.username.toLowerCase().replace(/[^a-z0-9]/g, '')}`;
        const jaTemTicket = interaction.guild.channels.cache.find(c => c.name === nomeCanal);
        
        if (jaTemTicket) return interaction.reply({ content: `⚠️ Você já tem um atendimento aberto aqui: ${jaTemTicket}`, ephemeral: true });

        await interaction.deferReply({ ephemeral: true });

        try {
            const canal = await interaction.guild.channels.create({
                name: nomeCanal,
                type: ChannelType.GuildText,
                parent: CATEGORY_ID,
                permissionOverwrites: [
                    { id: interaction.guild.id, deny: [PermissionsBitField.Flags.ViewChannel] }, // Ninguém vê
                    { id: interaction.user.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages] }, // Usuário vê
                    { id: SUPPORT_ROLE_ID, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages] }, // Suporte vê
                    { id: client.user.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages] } // Bot vê
                ]
            });

            await interaction.editReply({ content: `✅ Ticket criado: ${canal}` });

            const embedBoasVindas = new EmbedBuilder()
                .setColor('#f1c40f')
                .setTitle(`Olá, ${interaction.user.username}`)
                .setDescription('**Para liberar seu acesso, digite agora o E-MAIL usado na compra.**');

            const btnFechar = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId('fechar_ticket').setLabel('Cancelar / Fechar').setStyle(ButtonStyle.Danger)
            );

            await canal.send({ content: `<@${interaction.user.id}>`, embeds: [embedBoasVindas], components: [btnFechar] });
            
            // Inicia o fluxo de conversa
            iniciarColetaDeEmail(canal, interaction.user);

        } catch (error) {
            console.error(error);
            await interaction.editReply('❌ Erro ao criar ticket. Verifique se o ID da Categoria (CATEGORY_ID) está correto e se o Bot tem permissão nela.');
        }
    }

    // --- FECHAR TICKET ---
    if (interaction.customId === 'fechar_ticket') {
        await interaction.reply('Encerrando ticket em 3 segundos...');
        setTimeout(() => interaction.channel?.delete().catch(() => {}), 3000);
    }
});

// Função Auxiliar de Coleta (Chat)
function iniciarColetaDeEmail(canal, usuario) {
    // Filtra mensagens apenas desse usuário
    const filter = m => m.author.id === usuario.id;
    const collector = canal.createMessageCollector({ filter, max: 1 });

    collector.on('collect', async (msg) => {
        const email = msg.content.trim(); // Remove espaços extras
        
        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('sim').setLabel('Confirmar').setStyle(ButtonStyle.Success),
            new ButtonBuilder().setCustomId('nao').setLabel('Corrigir').setStyle(ButtonStyle.Secondary)
        );

        const msgConf = await canal.send({ content: `Você digitou: **${email}**. Está correto?`, components: [row] });
        const btnCol = msgConf.createMessageComponentCollector({ componentType: ComponentType.Button, time: 60000 });

        btnCol.on('collect', async (i) => {
            if (i.user.id !== usuario.id) return;

            if (i.customId === 'sim') {
                await i.update({ content: `🔄 Validando **${email}** com o servidor...`, components: [] });
                
                try {
                    // Chama o n8n
                    const resp = await axios.post(WEBHOOK_VALIDACAO_URL, {
                        tipo: "VALIDACAO_TICKET",
                        email: email,
                        discord_id: usuario.id,
                        username: usuario.username
                    });
                    
                    // Lê a resposta do n8n
                    const texto = resp.data.reply || "Processado pelo servidor.";
                    const aprovado = resp.data.approved === true;

                    const embedResultado = new EmbedBuilder()
                        .setDescription(texto)
                        .setColor(aprovado ? '#00FF00' : '#FF0000');

                    await canal.send({ embeds: [embedResultado] });

                    // Se aprovado, entrega o Cargo VIP
                    if (aprovado && CLIENT_ROLE_ID) {
                        try {
                            const member = await canal.guild.members.fetch(usuario.id);
                            await member.roles.add(CLIENT_ROLE_ID);
                            await canal.send(`🎉 **Parabéns! O cargo <@&${CLIENT_ROLE_ID}> foi entregue e agora você tem acesso ao Discord dos Irmãos**`);
                        } catch (e) {
                            await canal.send(`⚠️ Compra aprovada, mas erro ao dar cargo: ${e.message}. Verifique a hierarquia de cargos.`);
                        }
                    }
                } catch (e) { 
                    await canal.send('❌ Erro de comunicação com o servidor de validação (n8n offline ou erro 500).'); 
                    console.error(e.message);
                }
                btnCol.stop();

            } else {
                // Se clicar em Corrigir
                await i.update({ content: '⚠️ Tudo bem, digite o e-mail novamente:', components: [] });
                iniciarColetaDeEmail(canal, usuario); // Reinicia o loop
                btnCol.stop();
            }
        });
    });
}

client.login(BOT_TOKEN);

