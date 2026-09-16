# 📜 Constituição Federal do Brasil — Anotada

Aplicação web para leitura e anotação da **Constituição Federal do Brasil de 1988**, com armazenamento local de anotações pessoais por usuário.

## 🌐 Hospedagem no GitHub Pages

### Passo a passo:

1. **Crie um repositório** no GitHub (ex: `constituicao-federal`)
2. **Envie os 4 arquivos** para o repositório:
   - `index.html`
   - `styles.css`
   - `app.js`
   - `constituicao.js`
3. Vá em **Settings → Pages**
4. Em *Source*, selecione **Deploy from a branch → main → / (root)**
5. Clique em **Save**
6. Aguarde 1–2 minutos e acesse: `https://<seu-usuario>.github.io/<nome-do-repo>/`

---

## ✨ Funcionalidades

- **Índice clicável** com todos os Títulos, Capítulos e Seções da CF, com setas expansíveis
- **Artigos destacados** em azul para fácil identificação
- **Campos de anotação** em cada artigo, inciso e parágrafo (até 1000 caracteres cada)
- **Múltiplos usuários** no mesmo site — cada um com seus dados individuais
- **Armazenamento local** via IndexedDB (dados ficam no navegador do usuário)
- **Exportar backup** — salva todas as anotações em arquivo `.json`
- **Importar backup** — recupera anotações de um arquivo de backup
- **Busca** no texto da Constituição com realce dos resultados
- **Bandeira do Brasil** estilizada na tela inicial
- **Design responsivo** para celular e desktop

---

## 🔒 Privacidade

Todos os dados são armazenados **exclusivamente no navegador do usuário** (IndexedDB). Nenhuma informação é enviada para servidores externos. Cada pessoa que acessar o site mantém seus próprios dados locais.

---

## 📁 Estrutura dos arquivos

```
constituicao-federal/
├── index.html        # Estrutura HTML da aplicação
├── styles.css        # Estilos visuais
├── app.js            # Lógica da aplicação (IndexedDB, renderização, busca)
└── constituicao.js   # Dados da CF estruturados em JSON (~580 KB)
```

---

## 🛠 Tecnologias

- **HTML5 / CSS3 / JavaScript** puro (sem dependências externas)
- **IndexedDB** para persistência de dados no navegador
- **SVG** para a bandeira do Brasil
- **GitHub Pages** para hospedagem gratuita

---

*Constituição da República Federativa do Brasil — Promulgada em 5 de outubro de 1988*
