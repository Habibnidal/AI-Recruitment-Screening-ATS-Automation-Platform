# Diagrams

This folder contains the system diagrams in [Mermaid](https://mermaid.js.org/) format plus a rendered PNG.

## Files

| File | Description |
|---|---|
| `architecture.mmd` | High-level system architecture — sources, orchestration, external services, output |
| `workflow-flowchart.mmd` | Step-by-step workflow showing all 21 numbered nodes and Path A / Path B branching |
| `architecture.png` | Pre-rendered architecture diagram (for users without Mermaid support) |

## Rendering the Diagrams

GitHub renders `.mmd` files inside markdown automatically. To render locally or export as PNG:

### Online (easiest)
1. Open [Mermaid Live Editor](https://mermaid.live)
2. Paste the contents of any `.mmd` file
3. Export as PNG or SVG from the menu

### Command Line
Install the Mermaid CLI:
```bash
npm install -g @mermaid-js/mermaid-cli
```

Generate a PNG:
```bash
mmdc -i architecture.mmd -o architecture.png -b transparent -w 1920
```

### VS Code
Install the **Mermaid Preview** extension and open any `.mmd` file. Preview pane will render live.

## Note on architecture.png

The PNG is a placeholder. To regenerate, use the command-line method above with the `.mmd` source.
