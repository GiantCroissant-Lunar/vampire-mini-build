---
name: docling
description: Convert documents (PDF, DOCX, PPTX, XLSX, HTML, images) into structured markdown for agent consumption. Use this skill when the user wants to process a document into text, extract content from a PDF or Office file, convert a game design document into issues, turn a spec sheet into a prompt, or ingest any document for AI processing. Also triggers when the user mentions "docling", "convert this document", "extract text from", "parse this PDF", or wants to feed document content into the pipeline.
---

# Docling — Document-to-Markdown Converter

Convert documents into structured markdown that agents can consume as task context, issue descriptions, or reference material.

## When to Use

- User has a PDF, DOCX, PPTX, XLSX, or image with content to extract
- Game design documents need to become GitHub issues
- Research papers or spec sheets need to feed into agent prompts
- Any document needs to be ingested as structured text

## Setup

Docling requires Python 3.10+. Install on first use:

```bash
pip install docling
```

For OCR support (scanned PDFs, images):
```bash
pip install docling[ocr]
```

## Quick Convert

### CLI (simplest)

```bash
# Single file → markdown (stdout)
docling ./game-design-doc.pdf --to md

# With output directory
docling ./spec.pdf --output ./converted/ --to md

# Multiple formats
docling ./doc.pdf --to md --to json

# From URL
docling https://example.com/document.pdf --to md

# Batch convert directory
docling ./docs/ --from pdf --output ./converted/
```

### Python API (for scripting)

```python
from docling.document_converter import DocumentConverter

converter = DocumentConverter()
doc = converter.convert("path/to/document.pdf").document
markdown = doc.export_to_markdown()
```

## Workflows

### 1. Document → GitHub Issues

Convert a game design document into agent-consumable issues:

```bash
# Step 1: Convert to markdown
docling ./gdd.pdf --output /tmp/ --to md

# Step 2: Read the markdown and create issues from sections
# (done by the agent after conversion)
```

After converting, read the markdown output and break it into focused GitHub issues labeled `agent`. Each issue should map to one implementable unit of work.

### 2. Document → Agent Prompt Context

Extract content from a reference doc to include in an agent prompt:

```bash
docling ./api-reference.pdf --to md --output /tmp/
```

Then read the output and embed relevant sections into the agent's task prompt.

### 3. Batch Processing

Convert a directory of design docs:

```bash
docling ./design-docs/ --output ./converted/ --to md
```

## Output Formats

| Format | Flag | Best For |
|--------|------|----------|
| Markdown | `--to md` | Agent prompts, issues, readable text |
| JSON | `--to json` | Structured data extraction, tables |
| HTML | `--to html` | Preserving formatting |
| DocTags | `--to doctags` | Document structure analysis |

## Supported Input Formats

PDF, DOCX, PPTX, XLSX, HTML, PNG, JPG, TIFF, BMP, AsciiDoc, Markdown, LaTeX

## Tips

- **Tables**: Docling preserves table structure — great for extracting stat tables from GDDs
- **Images**: Use `docling[ocr]` for scanned documents or screenshots
- **Large docs**: For very large PDFs, convert to JSON first to get structured sections, then process selectively
- **VLM pipeline**: For complex layouts, use `docling --pipeline vlm --vlm-model granite_docling` (requires more resources)

## Integration with This Project

The primary use case is converting game design documents or research material into structured content that the orchestrator or agents can work with:

1. **GDD → Issues**: Convert a game design document, then create `plan`-labeled issues for the orchestrator to decompose
2. **Research → Prompts**: Convert academic papers or technical docs into reference material for agent prompts
3. **Spec → Tests**: Convert specification documents into test requirements that agents can implement as GdUnit4 tests
