


# 🎨 Painter

Um projeto web para pintar em um **quadro interativo**, armazenar o estado do quadro e possivelmente servir como backend para colaboração ou arte online. Projetado com HTML, CSS, JavaScript e um servidor Node.js simples.

---

## 📌 Visão Geral

**Painter** é uma aplicação de pintura interativa baseada na Web que permite que os usuários desenhem, salvem e compartilhem seus quadros. O projeto serve tanto uma interface visual quanto um backend leve para armazenar e atualizar o estado do quadro. Ele pode ser usado como base para aplicativos colaborativos, experimentos artísticos ou ferramentas de visualização em tempo real.

---

## 🚀 Funcionalidades

* ✏️ Interface de pintura em canvas web
* 💾 Persistência do estado do quadro
* 🔄 Atualizações em tempo real
* 📡 Backend Node.js para servir a aplicação e gerenciar dados
* 🌐 Deploy simples (suporta Render ou outras plataformas)

---

## 📁 Estrutura do Projeto

Aqui está uma visão geral simplificada da estrutura:

```
.
├── public/                 # Arquivos estáticos servidos ao cliente
├── .gitignore
├── board.dat               # Arquivo de dados do quadro
├── package-lock.json
├── package.json            # Dependências e scripts
├── render.yaml             # Configuração para deploy
├── server.js               # Servidor HTTP Node.js
└── README.md
```

---

## 🧠 Pré-Requisitos

Antes de começar, certifique-se de ter instalado:

* **Node.js** (v16+ recomendado)
* **npm** (gerenciador de pacotes do Node.js)

---

## ⚙️ Como Instalar

1. Clone o repositório:

```bash
git clone https://github.com/Stoltemberg/painter.git
```

2. Entre no diretório:

```bash
cd painter
```

3. Instale as dependências:

```bash
npm install
```

---

## 🚀 Executando a Aplicação

Para iniciar o servidor localmente:

```bash
npm start
```

Ou, se definido no `package.json`:

```bash
node server.js
```

Acesse no navegador:

```
http://localhost:3000
```

*(Se a porta for diferente, ajuste conforme configuração em `server.js`)*

---

## 🧪 Como Usar

* Acesse a interface web.
* Use as ferramentas do canvas para desenhar e criar.
* O estado do quadro pode ser salvo ou enviado ao servidor.
* Expanda a aplicação para permitir múltiplos usuários ou sessões.

---

## 📦 Deploy

Você pode fazer o deploy facilmente em plataformas como:

* **Render**
* **Heroku**
* **Vercel**
* **Railway**

Basta apontar para o `server.js` e configurar variáveis de ambiente conforme necessário.

---

## 🤝 Contribuindo

Contribuições são bem-vindas! Aqui estão algumas maneiras de ajudar:

* 🐛 Reportar bugs ou sugerir melhorias
* 📈 Adicionar novas funcionalidades
* ✨ Melhorar a interface de pintura
* 🧠 Implementar suporte a múltiplos usuários

Abra uma issue ou um pull request!

---

## 📝 Licença

Este projeto é distribuído sob a licença **MIT**. Veja o arquivo [LICENSE](./LICENSE) para detalhes.

---

## 📬 Contato

Se você tiver dúvidas ou quiser colaborar, sinta-se à vontade para abrir uma *issue* ou enviar uma mensagem!
