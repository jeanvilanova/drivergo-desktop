<p align="center">
  <img src="assets/icon.ico" width="72" alt="DriveGO" />
</p>

<h1 align="center">DriveGO Desktop</h1>

<p align="center">
  Aplicativo desktop Windows para sincronização, backup e gerenciamento de arquivos em nuvem.<br/>
  Desenvolvido por <strong>SuporteGO</strong> · CNPJ 53.516.622/0001-33
</p>

<p align="center">
  <img src="https://img.shields.io/badge/version-1.0.0-5caeff?style=flat-square" />
  <img src="https://img.shields.io/badge/platform-Windows-0078d7?style=flat-square&logo=windows" />
  <img src="https://img.shields.io/badge/electron-41.x-47848f?style=flat-square&logo=electron" />
  <img src="https://img.shields.io/badge/react-19.x-61dafb?style=flat-square&logo=react" />
</p>

---

## Visão Geral

O **DriveGO Desktop** é o cliente Windows da plataforma DriveGO — um sistema de armazenamento e backup em nuvem focado em empresas. O app roda em segundo plano na bandeja do sistema, sincronizando pastas automaticamente, executando backups programados e mapeando os arquivos em nuvem como uma unidade de disco local no Windows Explorer.

---

## Funcionalidades

### ☁️ Meus Arquivos
- Navegação completa pelos arquivos armazenados na nuvem
- Upload de arquivos com progresso em tempo real
- Download com URL presignada (S3/MinIO)
- Visualização por tipo com ícones coloridos

### 🔄 Sincronização Automática
- Monitoramento em tempo real de pastas locais via **chokidar**
- Upload automático ao detectar novos arquivos ou alterações
- **Sincronização diferencial** na inicialização: compara arquivos locais com a nuvem e envia apenas o que está faltando
- Indicador visual de status por pasta: ✓ sincronizado / ⟳ sincronizando / ⚠ erro
- Ressincronização manual forçada

### 💾 Armazenamento
- Gráfico de uso em tempo real (donut ring)
- Visualização de consumo por categoria
- Alerta de capacidade

### 💽 Unidade Mapeada
- Mapeia os arquivos em nuvem como uma unidade de disco Windows (`subst`)
- Escolha livre da letra da unidade (D: a Z:)
- Estrutura automática: `Meus Arquivos\` e `Compartilhado comigo\`
- Restauração automática da unidade ao iniciar o Windows
- Sincronização do conteúdo para disco local em background
- Geração de **links compartilháveis** para qualquer arquivo ou pasta

### 🗄️ Backup Programado
- Dois tipos de backup:
  - **Arquivo**: selecione pastas, comprime com **7-Zip ultra** (LZMA2 -mx=9) — 30–70% menor que ZIP
  - **Banco de Dados**: Firebird (gbak), SQL Server (sqlcmd), PostgreSQL (pg_dump), DB2, Oracle
- Agendamento **diário** ou **semanal** com horário configurável
- **Política de retenção** local: mantém os N backups mais recentes, deleta os antigos
- Upload automático do `.7z` para nuvem após compressão
- Execução manual com um clique

### 🗒️ Log de Atividade
- Log em tempo real com categorias: Sistema, Sync, Upload, Pasta, Backup
- Filtros por nível (INFO, OK, AVISO, ERRO) e categoria
- Indicador de erros no menu lateral
- Auto-scroll com opção de pausar

### ℹ️ Sobre
- Informações da empresa (SuporteGO, CNPJ 53.516.622/0001-33)
- Link direto para [drivego.app.br](https://drivego.app.br)
- **QR Code** de suporte via WhatsApp (62) 98237-1401

---

## Comportamento do Sistema

| Situação | Comportamento |
|---|---|
| Iniciar o Windows | App inicia minimizado na bandeja |
| Fechar a janela | Minimiza para bandeja (não encerra) |
| Clicar no ícone da bandeja | Mostra/oculta a janela |
| Login do usuário | Dispara sincronização diferencial de todas as pastas |
| Arquivo novo na pasta monitorada | Upload em 2,5s (debounce) |
| Horário de backup configurado | Executa automaticamente (verificação a cada 60s) |

---

## Stack Técnica

| Camada | Tecnologia |
|---|---|
| Desktop | Electron 41 + Electron Forge + Squirrel |
| UI | React 19 + TypeScript |
| Build | Vite 5 |
| Monitoramento | chokidar 3 |
| Compressão | 7-Zip (7zip-bin — bundled no instalador) |
| Storage | S3/MinIO via AWS4-HMAC-SHA256 presigned URLs |
| Backend | Supabase Edge Functions (Deno) |
| QR Code | qrcode (gerado localmente) |

---

## Estrutura do Projeto

```
src/
├── main.ts                  # Processo principal Electron
├── preload.ts               # Bridge segura (contextBridge)
├── renderer.tsx             # Entrada React
├── electron-api.d.ts        # Tipos globais da API Electron
├── index.css                # Design system DriveGO (tokens CSS)
│
├── components/
│   ├── Layout.tsx           # Shell: sidebar + titlebar
│   └── Icons.tsx            # Ícones SVG inline
│
├── screens/
│   ├── LoginScreen.tsx
│   ├── FilesScreen.tsx
│   ├── StorageScreen.tsx
│   ├── SyncScreen.tsx
│   ├── DriveScreen.tsx      # Unidade mapeada
│   ├── BackupScreen.tsx     # Backup programado
│   ├── LogScreen.tsx        # Log de atividade
│   └── AboutScreen.tsx      # Sobre + QR Code
│
└── lib/
    ├── uploader-main.ts     # Upload S3 (Node streams), listagem, sharing
    ├── sync-store.ts        # Persistência das pastas sincronizadas
    ├── backup-store.ts      # Persistência das configs de backup
    ├── backup-runner.ts     # Execução de backups (7-Zip + ferramentas DB)
    ├── drive-store.ts       # Config da unidade mapeada
    ├── drive-mapper.ts      # subst, sync para disco, links
    ├── logger.ts            # Log em memória com push para renderer
    ├── session.ts           # Sessão do usuário
    └── CloudClient.ts       # API de autenticação
```

---

## Update Automático

O app usa **Squirrel.Windows** para atualizações automáticas. Ao publicar uma nova versão:

1. Gere o instalador: `npm run make`
2. Faça upload de `DriveGo-Setup.exe`, `DriveGo-X.X.X-full.nupkg` e `RELEASES` para a Release do GitHub
3. O app verifica atualizações automaticamente e instala em background

---

## Desenvolvimento

```bash
npm install
npm start          # inicia em modo dev (hot reload)
npm run make       # gera DriveGo-Setup.exe em out/make/
```

---

## Suporte

| Canal | Contato |
|---|---|
| Site | [drivego.app.br](https://drivego.app.br) |
| WhatsApp | (62) 98237-1401 |
| E-mail | jean@suportego.com.br |

---

<p align="center">
  © 2025 SuporteGO · CNPJ 53.516.622/0001-33 · Todos os direitos reservados
</p>
