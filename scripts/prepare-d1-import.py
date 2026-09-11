#!/usr/bin/env python3
from pathlib import Path
import hashlib, json, re, sqlite3, sys

source, output, metadata_path = map(Path, sys.argv[1:])
text = source.read_text(errors='strict')

def split_sql(s):
    statements=[]; start=0; state='normal'; i=0
    while i < len(s):
        c=s[i]; n=s[i+1] if i+1 < len(s) else ''
        if state=='normal':
            if c=="'": state='single'
            elif c=='"': state='double'
            elif c=='`': state='backtick'
            elif c=='[': state='bracket'
            elif c=='-' and n=='-': state='line_comment'; i+=1
            elif c=='/' and n=='*': state='block_comment'; i+=1
            elif c==';': statements.append(s[start:i+1]); start=i+1
        elif state=='single':
            if c=="'":
                if n=="'": i+=1
                else: state='normal'
        elif state=='double':
            if c=='"':
                if n=='"': i+=1
                else: state='normal'
        elif state=='backtick':
            if c=='`':
                if n=='`': i+=1
                else: state='normal'
        elif state=='bracket':
            if c==']': state='normal'
        elif state=='line_comment':
            if c=='\n': state='normal'
        elif state=='block_comment':
            if c=='*' and n=='/': state='normal'; i+=1
        i+=1
    if s[start:].strip(): statements.append(s[start:])
    return statements

def strip_comments(stmt):
    return re.sub(r'^\s*(?:(?:--[^\n]*\n)|(?:/\*.*?\*/\s*))*', '', stmt, flags=re.S)

def identifier(name):
    return '"' + name.replace('"','""') + '"'

def literal(value):
    if value is None: return 'NULL'
    if isinstance(value, bytes): return "X'" + value.hex() + "'"
    if isinstance(value, str): return "'" + value.replace("'", "''") + "'"
    if isinstance(value, bool): return '1' if value else '0'
    if isinstance(value, int): return str(value)
    if isinstance(value, float): return format(value, '.17g')
    raise TypeError(type(value))

def chunks(value, max_bytes=32000):
    if isinstance(value, bytes):
        return [value[i:i+max_bytes//2] for i in range(0,len(value),max_bytes//2)]
    result=[]; current=[]; size=0
    for ch in value:
        b=len(ch.encode())
        if current and size+b > max_bytes:
            result.append(''.join(current)); current=[]; size=0
        current.append(ch); size+=b
    if current: result.append(''.join(current))
    return result

statements=split_sql(text)
create_tables={}
for stmt in statements:
    clean=strip_comments(stmt)
    m=re.match(r'CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:"([^"]+)"|`([^`]+)`|\[([^]]+)\]|([A-Za-z_][A-Za-z0-9_]*))', clean, re.I)
    if m: create_tables[next(x for x in m.groups() if x is not None)]=stmt

max_statement=90000
rewritten=[]; cells=[]; transformed=[]
for position,stmt in enumerate(statements,1):
    size=len(stmt.encode())
    if size <= max_statement:
        transformed.append(stmt); continue
    clean=strip_comments(stmt)
    m=re.match(r'INSERT(?:\s+OR\s+[A-Za-z]+)?\s+INTO\s+(?:"([^"]+)"|`([^`]+)`|\[([^]]+)\]|([A-Za-z_][A-Za-z0-9_]*))', clean, re.I)
    if not m:
        raise RuntimeError(f'oversized non-INSERT statement at position {position}')
    table=next(x for x in m.groups() if x is not None)
    if table not in create_tables:
        raise RuntimeError(f'CREATE TABLE not found for oversized INSERT into {table}')
    db=sqlite3.connect(':memory:')
    db.executescript(create_tables[table])
    db.execute(stmt)
    info=db.execute(f'PRAGMA table_info({identifier(table)})').fetchall()
    columns=[row[1] for row in info]
    pk_columns=[row[1] for row in sorted((r for r in info if r[5]), key=lambda r:r[5])]
    if not pk_columns:
        raise RuntimeError(f'oversized INSERT table {table} has no primary key')
    rows=db.execute(f'SELECT * FROM {identifier(table)}').fetchall()
    for row in rows:
        values=dict(zip(columns,row))
        large={name:value for name,value in values.items() if isinstance(value,(str,bytes)) and len(literal(value).encode()) > 32000}
        if not large:
            raise RuntimeError(f'oversized INSERT into {table} has no splittable value')
        base_values=[('' if isinstance(values[c],str) else b'') if c in large else values[c] for c in columns]
        base=f'INSERT INTO {identifier(table)} ({", ".join(identifier(c) for c in columns)}) VALUES ({", ".join(literal(v) for v in base_values)});'
        if len(base.encode()) > max_statement:
            raise RuntimeError(f'rewritten base INSERT into {table} remains oversized')
        transformed.append('\n'+base)
        where=' AND '.join(f'{identifier(c)} IS {literal(values[c])}' for c in pk_columns)
        for column,value in large.items():
            for piece in chunks(value):
                update=f'UPDATE {identifier(table)} SET {identifier(column)} = {identifier(column)} || {literal(piece)} WHERE {where};'
                if len(update.encode()) > max_statement:
                    raise RuntimeError(f'rewritten UPDATE for {table}.{column} remains oversized')
                transformed.append('\n'+update)
            raw=value if isinstance(value,bytes) else value.encode()
            cells.append({'table':table,'column':column,'where_sql':where,'kind':'blob' if isinstance(value,bytes) else 'text','characters':len(value),'bytes':len(raw),'sha256':hashlib.sha256(raw).hexdigest()})
    rewritten.append({'position':position,'table':table,'original_bytes':size,'rows':len(rows)})
    db.close()

output.write_text(''.join(transformed))
output.chmod(0o600)
after=split_sql(output.read_text(errors='strict'))
largest=max((len(s.encode()) for s in after),default=0)
if largest > max_statement:
    raise RuntimeError('transformed import still has an oversized statement')
metadata_path.write_text(json.dumps({'rewritten_statements':rewritten,'rewritten_cells':cells,'max_statement_before':max(len(s.encode()) for s in statements),'max_statement_after':largest},separators=(',',':')))
metadata_path.chmod(0o600)