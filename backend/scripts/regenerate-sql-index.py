#!/usr/bin/env python3
"""
Regenerate perfettoSqlIndex.light.json from the Perfetto stdlib source.

Extracts CREATE PERFETTO FUNCTION/TABLE/VIEW declarations with their
documentation comments. Produces a compact index used by the
sqlKnowledgeBase for Claude's lookup_sql_schema tool.

Usage:
    python3 scripts/regenerate-sql-index.py

Output:
    data/perfettoSqlIndex.light.json
"""

import json
import re
import sys
from datetime import datetime
from pathlib import Path

# Paths
SCRIPT_DIR = Path(__file__).parent
BACKEND_DIR = SCRIPT_DIR.parent
REPO_ROOT = BACKEND_DIR.parent
PERFETTO_DIR = REPO_ROOT / "perfetto"
STDLIB_DIR = PERFETTO_DIR / "src" / "trace_processor" / "perfetto_sql" / "stdlib"
OUTPUT_FILE = BACKEND_DIR / "data" / "perfettoSqlIndex.light.json"
# Relative path stored in output — portable across machines, no /Users/<name> leak.
STDLIB_REL = STDLIB_DIR.relative_to(REPO_ROOT).as_posix()

# Also extract from the built-in views/tables
BUILTIN_DIR = PERFETTO_DIR / "src" / "trace_processor" / "perfetto_sql" / "stdlib" / "prelude"

# Pattern to match CREATE PERFETTO declarations
CREATE_RE = re.compile(
    r"CREATE\s+PERFETTO\s+(FUNCTION|TABLE|VIEW|MACRO)\s+"
    r"(\w+(?:\.\w+)*)\s*\(",
    re.IGNORECASE,
)

# Pattern for simpler CREATE VIEW (non-PERFETTO)
CREATE_VIEW_RE = re.compile(
    r"CREATE\s+(?:OR\s+REPLACE\s+)?PERFETTO\s+VIEW\s+(\w+)",
    re.IGNORECASE,
)

# Pattern for RETURNS TABLE columns
RETURNS_COL_RE = re.compile(
    r"^\s+--\s+(.+)$"
)

def extract_doc_comment(lines: list[str], decl_line_idx: int) -> str:
    """Extract the documentation comment block immediately before a declaration."""
    comments = []
    i = decl_line_idx - 1

    # Walk backwards through comment lines
    while i >= 0:
        line = lines[i].strip()
        if line.startswith("--"):
            text = line[2:].strip()
            # Stop at copyright block
            if "Copyright" in text and "Android Open Source" in text:
                break
            if "Licensed under" in text or "Apache License" in text:
                break
            if text == "":
                # Empty comment line — might be separator
                if comments:
                    # Check if next line up is also a comment
                    if i > 0 and lines[i - 1].strip().startswith("--"):
                        comments.insert(0, "")
                        i -= 1
                        continue
                    break
                i -= 1
                continue
            comments.insert(0, text)
        else:
            break
        i -= 1

    return " ".join(c for c in comments if c).strip()


def extract_params(lines: list[str], start_idx: int) -> list[dict]:
    """Extract function parameters with their doc comments."""
    params = []
    i = start_idx
    current_comment = ""

    while i < len(lines):
        line = lines[i].strip()

        # Doc comment for parameter
        if line.startswith("--"):
            current_comment = line[2:].strip()
            i += 1
            continue

        # Parameter line (name TYPE)
        param_match = re.match(r"(\w+)\s+([\w().,\s]+?)(?:,\s*)?$", line)
        if param_match:
            name = param_match.group(1)
            ptype = param_match.group(2).strip()
            if name.upper() not in ("RETURNS", "AS", "BEGIN"):
                params.append({
                    "name": name,
                    "type": ptype,
                    "description": current_comment,
                })
            current_comment = ""

        # End of parameters
        if ")" in line and not line.startswith("--"):
            break

        i += 1

    return params


def extract_return_columns(lines: list[str], start_idx: int) -> list[dict]:
    """Extract RETURNS TABLE columns."""
    columns = []
    i = start_idx
    current_comment = ""
    in_returns = False

    while i < len(lines):
        line = lines[i].strip()

        if "RETURNS TABLE" in line.upper():
            in_returns = True
            i += 1
            continue

        if not in_returns:
            i += 1
            continue

        if line.startswith("--"):
            current_comment = line[2:].strip()
            i += 1
            continue

        col_match = re.match(r"(\w+)\s+([\w().,\s]+?)(?:,\s*)?$", line)
        if col_match:
            name = col_match.group(1)
            ctype = col_match.group(2).strip()
            columns.append({
                "name": name,
                "type": ctype,
                "description": current_comment,
            })
            current_comment = ""

        if line.startswith(")"):
            break

        i += 1

    return columns


# Pattern for @column annotations in doc comments
AT_COLUMN_RE = re.compile(
    r"^--\s+@column\s+(?:(\w+)\s+)?(\w+)\s+(.*?)$"
)


def extract_at_columns(lines: list[str], decl_line_idx: int) -> list[dict]:
    """Extract @column annotations from doc comments above a declaration.

    Supports two formats found in the Perfetto stdlib:
      -- @column column_name   Description text
      -- @column TYPE column_name   Description text
    """
    columns = []
    i = decl_line_idx - 1

    while i >= 0:
        line = lines[i].strip()
        if not line.startswith("--"):
            break

        # Stop at copyright block
        text = line[2:].strip()
        if "Copyright" in text and "Android Open Source" in text:
            break
        if "Licensed under" in text or "Apache License" in text:
            break

        # Match @column annotations
        m = re.match(r"@column\s+(\w+)\s+(\w+)\s*(.*)", text)
        if m:
            # Format: @column TYPE name Description
            columns.insert(0, {
                "name": m.group(2),
                "type": m.group(1),
                "description": m.group(3).strip(),
            })
        else:
            m2 = re.match(r"@column\s+(\w+)\s*(.*)", text)
            if m2:
                # Format: @column name Description
                columns.insert(0, {
                    "name": m2.group(1),
                    "type": "UNKNOWN",
                    "description": m2.group(2).strip(),
                })

        i -= 1

    return columns


def extract_view_columns(lines: list[str], start_idx: int) -> list[dict]:
    """Extract columns from CREATE PERFETTO VIEW name (...) declarations.

    Views define columns in parentheses directly after the name, using the
    same format as function parameters:
      CREATE PERFETTO VIEW name (
        -- Column description.
        col_name TYPE,
        ...
      )
    """
    columns = []
    i = start_idx
    current_comment = ""

    while i < len(lines):
        line = lines[i].strip()

        if line.startswith("--"):
            current_comment = line[2:].strip()
            i += 1
            continue

        col_match = re.match(r"(\w+)\s+([\w().,\s]+?)(?:,\s*)?$", line)
        if col_match:
            name = col_match.group(1)
            ctype = col_match.group(2).strip()
            if name.upper() not in ("AS", "SELECT", "WITH"):
                columns.append({
                    "name": name,
                    "type": ctype,
                    "description": current_comment,
                })
            current_comment = ""

        if ")" in line and not line.startswith("--"):
            break

        i += 1

    return columns


def parse_sql_file(filepath: Path, category: str) -> list[dict]:
    """Parse a single SQL file and extract all declarations."""
    templates = []

    try:
        content = filepath.read_text(encoding="utf-8")
    except Exception:
        return templates

    lines = content.split("\n")

    for i, line in enumerate(lines):
        match = CREATE_RE.search(line)
        if not match:
            # Try simpler CREATE VIEW (no parens after name, e.g., CREATE PERFETTO VIEW name AS ...)
            view_match = CREATE_VIEW_RE.search(line)
            if view_match:
                name = view_match.group(1)
                desc = extract_doc_comment(lines, i)
                # Try @column annotations from doc comments
                columns = extract_at_columns(lines, i)
                templates.append({
                    "id": f"stdlib.{category}.{name}",
                    "name": name,
                    "category": category,
                    "type": "view",
                    "description": desc or f"View: {name}",
                    "columns": [{"name": c["name"], "type": c["type"]} for c in columns] if columns else [],
                })
            continue

        decl_type = match.group(1).lower()  # function, table, view, macro
        name = match.group(2)

        desc = extract_doc_comment(lines, i)
        params = extract_params(lines, i + 1) if decl_type == "function" else []

        # Extract columns based on declaration type
        if decl_type in ("function", "table"):
            columns = extract_return_columns(lines, i)
        elif decl_type == "view":
            # View columns are in parens directly after the name (same format as params)
            columns = extract_view_columns(lines, i + 1)
        else:
            columns = []

        # Fallback: try @column annotations from doc comments if no inline columns found
        if not columns and decl_type in ("view", "table"):
            columns = extract_at_columns(lines, i)

        # Build template entry
        entry = {
            "id": f"stdlib.{category}.{name}",
            "name": name,
            "category": category,
            "type": decl_type,
            "description": desc or f"{decl_type.title()}: {name}",
        }

        if columns:
            entry["columns"] = [{"name": c["name"], "type": c["type"]} for c in columns]
        if params:
            entry["params"] = [{"name": p["name"], "type": p["type"]} for p in params]

        templates.append(entry)

    return templates


def main():
    if not STDLIB_DIR.exists():
        print(f"Error: stdlib directory not found at {STDLIB_DIR}", file=sys.stderr)
        sys.exit(1)

    all_templates = []
    file_count = 0

    # Walk through all .sql files in stdlib
    for sql_file in sorted(STDLIB_DIR.rglob("*.sql")):
        rel = sql_file.relative_to(STDLIB_DIR)
        parts = list(rel.parts)

        # Category is the top-level directory (android, slices, counters, etc.)
        category = parts[0] if len(parts) > 1 else "core"

        # Skip internal/test files
        if any(p.startswith("_") or p == "test" for p in parts[:-1]):
            continue

        templates = parse_sql_file(sql_file, category)
        if templates:
            all_templates.extend(templates)
            file_count += 1

    # Deduplicate by name (keep first occurrence)
    seen = set()
    unique_templates = []
    for t in all_templates:
        if t["name"] not in seen:
            seen.add(t["name"])
            unique_templates.append(t)

    # Build output
    output = {
        "version": "2.0",
        "generatedAt": datetime.now().isoformat(),
        "source": STDLIB_REL,
        "templates": unique_templates,
        "scenarios": [],  # Preserved for compatibility
    }

    # Write output
    OUTPUT_FILE.parent.mkdir(parents=True, exist_ok=True)
    with open(OUTPUT_FILE, "w", encoding="utf-8") as f:
        json.dump(output, f, indent=2, ensure_ascii=False)

    # Stats
    types = {}
    desc_quality = {"good": 0, "placeholder": 0}
    with_columns = 0
    total_columns = 0
    for t in unique_templates:
        types[t["type"]] = types.get(t["type"], 0) + 1
        if t["description"].startswith(("Function:", "View:", "Table:", "Macro:")) or len(t["description"]) < 10:
            desc_quality["placeholder"] += 1
        else:
            desc_quality["good"] += 1
        if t.get("columns"):
            with_columns += 1
            total_columns += len(t["columns"])

    print(f"Regenerated {OUTPUT_FILE.name}")
    print(f"  Files scanned: {file_count}")
    print(f"  Templates: {len(unique_templates)}")
    print(f"  Types: {types}")
    print(f"  Description quality: {desc_quality['good']} good, {desc_quality['placeholder']} placeholder")
    print(f"  Column coverage: {with_columns}/{len(unique_templates)} templates ({total_columns} total columns)")


if __name__ == "__main__":
    main()
