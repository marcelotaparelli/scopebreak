# AGENTS.md — SCOPEBREAK

## Ambiente de desenvolvimento (VMs de agentes) — regra permanente

- Nas VMs de agentes, aplicações web devem ouvir internamente em `0.0.0.0:3000`.
- NÃO usar `localhost`, `127.0.0.1`, porta 5173 ou a porta externa do host como bind do app.
- A porta externa (`localhost:3001` neste projeto) é configurada pelo port-forward da VM
  (`host localhost:3001 → VM:3000`) e não deve ser usada pelo servidor dentro da VM.
- Depois de `recreate` da VM, processos antigos deixam de existir e o dev server
  precisa ser iniciado novamente.
- Antes de dizer que o app está disponível, verificar LISTEN em `0.0.0.0:3000`
  e uma requisição HTTP local bem-sucedida.
- Quando solicitado a deixar o app disponível para teste, manter o processo rodando.
- Não criar túnel Cloudflare ou outro workaround sem solicitação explícita.
