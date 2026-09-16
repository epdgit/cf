import json, re, sys

with open('$HOME/mnt/Pasta_claude_oab/cf-app/constituicao.js','r',encoding='utf-8') as f:
    raw = f.read()

prefix = raw[:raw.index('{')]
start = raw.index('{')
end = raw.rindex('}') + 1
data = json.loads(raw[start:end])

def find_all_artigos():
    results = {}
    def search(obj):
        if isinstance(obj, dict):
            if 'numero' in obj and 'texto' in obj and ('incisos' in obj or 'paragrafos' in obj):
                results[str(obj['numero'])] = obj
            for v in obj.values():
                search(v)
        elif isinstance(obj, list):
            for item in obj:
                search(item)
    search(data)
    return results

arts = find_all_artigos()

def fix_quotes(s):
    return s.replace('&quot;', '"')

def renumber(items, prefix):
    for i, item in enumerate(items):
        item['id'] = f"{prefix}{i+1}"

def split_at(text, marker):
    """Split text at marker, returning (before, after_incl_marker)"""
    idx = text.find(marker)
    if idx < 0:
        return None, None
    return text[:idx].strip(), text[idx:].strip()

# ===========================================================
# FIX 1: Art 5 XXXI - &quot; -> "
# ===========================================================
art5 = arts['5']
for inc in art5['incisos']:
    if '&quot;' in inc.get('texto',''):
        inc['texto'] = fix_quotes(inc['texto'])
print("Fix 1 done: Art 5 quotes")

# ===========================================================
# FIX 2: Art 52 - split inc 1 (I condensed with II)
# ===========================================================
art52 = arts['52']
inc1 = art52['incisos'][0]
txt = inc1['texto']
idx = txt.find(' II processar')
if idx > 0:
    inc1['texto'] = txt[:idx].strip()
    new_ii = {
        "id": "art_52_inc_2",
        "texto": "II - processar e julgar os Ministros" + txt[idx + len(' II processar e julgar os Ministros'):].strip(),
        "alineas": []
    }
    art52['incisos'].insert(1, new_ii)
    renumber(art52['incisos'], 'art_52_inc_')
    print("Fix 2 done: Art 52 split I+II")
else:
    print("Fix 2 SKIP: Art 52 split marker not found")

# ===========================================================
# FIX 3: Art 59 par único - remove "Subseção II..." suffix
# ===========================================================
art59 = arts['59']
for par in art59['paragrafos']:
    txt = par.get('texto','')
    idx = txt.find(' Subseção II')
    if idx > 0:
        par['texto'] = txt[:idx].strip()
        print("Fix 3 done: Art 59 par único cleaned")
        break

# ===========================================================
# FIX 4: Art 92 - split I/I-A and II/II-A
# ===========================================================
art92 = arts['92']
# Split inc 0: I + I-A
inc0 = art92['incisos'][0]
txt = inc0['texto']
idx = txt.find('; I-A ')
if idx > 0:
    inc0['texto'] = txt[:idx+1].strip()  # keep semicolon
    ia_text = 'I-A - ' + txt[idx+6:].strip()
    art92['incisos'].insert(1, {"id": "art_92_inc_2", "texto": ia_text, "alineas": []})
    print("Fix 4a done: Art 92 split I/I-A")

# Split what was inc[1] (now at [2]): II + II-A  
inc2 = art92['incisos'][2]
txt2 = inc2['texto']
idx2 = txt2.find('; II-A ')
if idx2 > 0:
    inc2['texto'] = txt2[:idx2+1].strip()
    iia_text = 'II-A - ' + txt2[idx2+7:].strip()
    art92['incisos'].insert(3, {"id": "art_92_inc_4", "texto": iia_text, "alineas": []})
    print("Fix 4b done: Art 92 split II/II-A")

renumber(art92['incisos'], 'art_92_inc_')

# ===========================================================
# FIX 5: Art 93 - split condensed incisos
# ===========================================================
art93 = arts['93']

# Inc[1] = II condensed with III and IV
inc_ii = art93['incisos'][1]
txt = inc_ii['texto']
idx_iii = txt.find(' III o acesso')
idx_iv  = txt.find(' IV previsão')
if idx_iii > 0 and idx_iv > 0:
    inc_ii['texto'] = txt[:idx_iii].strip()
    iii_text = 'III - o acesso' + txt[idx_iii + len(' III o acesso'):idx_iv].strip()
    # Actually full: "III " + rest until IV
    iii_full = 'III - ' + txt[idx_iii+4:idx_iv].strip()
    iv_full  = 'IV - '  + txt[idx_iv+4:].strip()
    art93['incisos'].insert(2, {"id": "art_93_inc_3", "texto": iii_full, "alineas": []})
    art93['incisos'].insert(3, {"id": "art_93_inc_4", "texto": iv_full,  "alineas": []})
    print("Fix 5a done: Art 93 split II/III/IV")

# Now inc[4]=V(ok), inc[5]=VI condensed with VII
inc_vi = art93['incisos'][5]
txt = inc_vi['texto']
idx_vii = txt.find(' VII o juiz')
if idx_vii > 0:
    inc_vi['texto'] = txt[:idx_vii].strip()
    vii_full = 'VII - ' + txt[idx_vii+4:].strip()
    art93['incisos'].insert(6, {"id": "art_93_inc_7", "texto": vii_full, "alineas": []})
    print("Fix 5b done: Art 93 split VI/VII")

# Now inc[7] = VIII condensed with VIII-A through XV
inc_viii = art93['incisos'][7]
txt = inc_viii['texto']

splits_93 = [
    (' VIII-A - a remoção', 'VIII-A'),
    (' VIII-B - a permuta', 'VIII-B'),
    (' IX todos', 'IX'),
    (' X as decisões', 'X'),
    (' XI nos tribunais', 'XI'),
    (' XII a atividade', 'XII'),
    (' XIII o número', 'XIII'),
    (' XIV os servidores', 'XIV'),
    (' XV a distribuição', 'XV'),
]
positions = []
for marker, roman in splits_93:
    idx = txt.find(marker)
    if idx >= 0:
        positions.append((idx, roman, marker))
positions.sort()

if positions:
    inc_viii['texto'] = fix_quotes(txt[:positions[0][0]].strip())
    for k, (pos, roman, marker) in enumerate(positions):
        end_pos = positions[k+1][0] if k+1 < len(positions) else len(txt)
        piece = txt[pos:end_pos].strip()
        # remove leading marker space
        piece_text = fix_quotes(roman + ' - ' + piece[len(marker.strip()):].strip())
        art93['incisos'].insert(8+k, {
            "id": f"art_93_inc_{8+k+1}",
            "texto": piece_text,
            "alineas": []
        })
    print(f"Fix 5c done: Art 93 split VIII through XV ({len(positions)} splits)")

renumber(art93['incisos'], 'art_93_inc_')

# ===========================================================
# FIX 6: Art 95 par único - split subitem 3 (III + IV + V)
# ===========================================================
art95 = arts['95']
par_un = art95['paragrafos'][0]
subitens = par_un.get('subitens', [])
if subitens:
    new_subitens = []
    for sub in subitens:
        txt = sub.get('texto','')
        # Check if condensed (IV or V hidden inside III)
        idx_iv = txt.find('. IV receber')
        idx_v  = txt.find('; V exercer') if '; V exercer' in txt else txt.find('; V - exercer')
        if idx_iv > 0:
            # Split III from IV
            new_subitens.append({**sub, 'texto': txt[:idx_iv+1].strip()})
            rest_after_iii = txt[idx_iv+3:].strip()  # skip ". IV"
            # Check V in rest
            idx_v2 = rest_after_iii.find('; V exercer')
            idx_v3 = rest_after_iii.find(' V exercer')
            if idx_v2 > 0:
                iv_text = 'IV - ' + rest_after_iii[:idx_v2+1].strip()
                v_text  = 'V - exercer' + rest_after_iii[idx_v2 + len('; V exercer'):].strip()
                new_subitens.append({"id": "art_95_par_1_sub_4", "texto": iv_text, "alineas": []})
                new_subitens.append({"id": "art_95_par_1_sub_5", "texto": v_text, "alineas": []})
            elif idx_v3 > 0:
                iv_text = 'IV - ' + rest_after_iii[:idx_v3].strip()
                v_text  = 'V - exercer' + rest_after_iii[idx_v3 + len(' V exercer'):].strip()
                new_subitens.append({"id": "art_95_par_1_sub_4", "texto": iv_text, "alineas": []})
                new_subitens.append({"id": "art_95_par_1_sub_5", "texto": v_text, "alineas": []})
            else:
                new_subitens.append({"id": "art_95_par_1_sub_4", "texto": 'IV - ' + rest_after_iii, "alineas": []})
        else:
            new_subitens.append(sub)
    par_un['subitens'] = new_subitens
    renumber(par_un['subitens'], 'art_95_par_1_sub_')
    print(f"Fix 6 done: Art 95 par único now has {len(new_subitens)} subitens")

# ===========================================================
# FIX 7: Art 96 par único - fix &quot; and "docaput"
# ===========================================================
art96 = arts['96']
for par in art96['paragrafos']:
    txt = par.get('texto','')
    txt = fix_quotes(txt).replace('docaput', 'do caput')
    par['texto'] = txt
print("Fix 7 done: Art 96 par único quotes/docaput")

# ===========================================================
# FIX 8: Art 103-B - split single condensed inciso I-XIII
# ===========================================================
art103b = arts['103-B']
inc_all = art103b['incisos'][0]
txt = inc_all['texto']

splits_103b = [
    (' II um Ministro do Superior Tribunal de Justiça', 'II'),
    (' III um Ministro do Tribunal Superior do Trabalho', 'III'),
    (' IV um desembargador', 'IV'),
    (' V um juiz estadual', 'V'),
    (' VI um juiz de Tribunal Regional Federal', 'VI'),
    (' VII um juiz federal', 'VII'),
    (' VIII um juiz de Tribunal Regional do Trabalho', 'VIII'),
    (' IX um juiz do trabalho', 'IX'),
    (' X um membro do Ministério Público da União', 'X'),
    (' XI um membro do Ministério Público estadual', 'XI'),
    (' XII dois advogados', 'XII'),
    (' XIII dois cidadãos', 'XIII'),
]
pos_103b = []
for marker, roman in splits_103b:
    idx = txt.find(marker)
    if idx >= 0:
        pos_103b.append((idx, roman, marker))
pos_103b.sort()

if pos_103b:
    inc_all['texto'] = txt[:pos_103b[0][0]].strip()
    for k, (pos, roman, marker) in enumerate(pos_103b):
        end_pos = pos_103b[k+1][0] if k+1 < len(pos_103b) else len(txt)
        piece = txt[pos:end_pos].strip()
        piece_text = roman + ' - ' + piece[len(marker.strip()):].strip()
        art103b['incisos'].insert(k+1, {
            "id": f"art_103_b_inc_{k+2}",
            "texto": piece_text,
            "alineas": []
        })
    renumber(art103b['incisos'], 'art_103_b_inc_')
    print(f"Fix 8 done: Art 103-B split {len(pos_103b)+1} incisos")

# ===========================================================
# FIX 9: Art 103-B par4 - add incisos I-VII from CF text
# ===========================================================
# Par4 ends correctly - the incisos were never stored. Add them now.
par4_103b = art103b['paragrafos'][3]
if not par4_103b.get('incisos'):
    par4_103b['incisos'] = [
        {"id":"art_103_b_par_4_inc_1","texto":"I - zelar pela autonomia administrativa e financeira do Poder Judiciário;","alineas":[]},
        {"id":"art_103_b_par_4_inc_2","texto":"II - zelar pela observância do art. 37 e apreciar, de ofício ou mediante provocação, a legalidade dos atos administrativos praticados por membros ou órgãos do Poder Judiciário, podendo desconstituí-los, revê-los ou fixar prazo para que se adotem as providências necessárias ao exato cumprimento da lei, sem prejuízo da competência do Tribunal de Contas da União;","alineas":[]},
        {"id":"art_103_b_par_4_inc_3","texto":"III - receber e conhecer das reclamações contra membros ou órgãos do Poder Judiciário, inclusive contra seus serviços auxiliares, serventias e órgãos prestadores de serviços notariais e de registro que atuem por delegação do poder público ou oficializados, sem prejuízo da competência disciplinar e correicional dos tribunais, podendo avocar processos disciplinares em curso e determinar a remoção, a disponibilidade ou a aposentadoria com subsídios ou proventos proporcionais ao tempo de serviço e aplicar outras sanções administrativas, assegurada ampla defesa;","alineas":[]},
        {"id":"art_103_b_par_4_inc_4","texto":"IV - representar ao Ministério Público, no caso de crime contra a administração pública ou de abuso de autoridade;","alineas":[]},
        {"id":"art_103_b_par_4_inc_5","texto":"V - rever, de ofício ou mediante provocação, os processos disciplinares de juízes e membros de tribunais julgados há menos de um ano;","alineas":[]},
        {"id":"art_103_b_par_4_inc_6","texto":"VI - elaborar semestralmente relatório estatístico sobre processos e sentenças prolatadas, por unidade da Federação, nos diferentes órgãos do Poder Judiciário;","alineas":[]},
        {"id":"art_103_b_par_4_inc_7","texto":"VII - elaborar relatório anual, propondo as providências que julgar necessárias, sobre a situação do Poder Judiciário no País e as atividades do Conselho, o qual deve integrar mensagem do Presidente do Supremo Tribunal Federal a ser remetida ao Congresso Nacional, por ocasião da abertura da sessão legislativa.","alineas":[]},
    ]
    print("Fix 9 done: Art 103-B par4 incisos added")

# ===========================================================
# FIX 10: Art 103-B par5 - split incisos I-III from condensed text
# ===========================================================
par5_103b = art103b['paragrafos'][4]
txt = par5_103b['texto']
if not par5_103b.get('incisos'):
    idx_i   = txt.find(' I receber as reclamações')
    idx_ii  = txt.find(' II exercer funções executivas')
    idx_iii = txt.find(' III requisitar e designar magistrados')
    if idx_i > 0:
        par5_103b['texto'] = txt[:idx_i].strip()
        incs = []
        if idx_ii > 0 and idx_iii > 0:
            incs.append({"id":"art_103_b_par_5_inc_1","texto":'I - receber' + txt[idx_i+len(' I receber'):idx_ii].strip(),"alineas":[]})
            incs.append({"id":"art_103_b_par_5_inc_2","texto":'II - exercer' + txt[idx_ii+len(' II exercer'):idx_iii].strip(),"alineas":[]})
            incs.append({"id":"art_103_b_par_5_inc_3","texto":'III - requisitar' + txt[idx_iii+len(' III requisitar'):].strip(),"alineas":[]})
        par5_103b['incisos'] = incs
        print("Fix 10 done: Art 103-B par5 incisos split")

# ===========================================================
# FIX 11: Art 105 - fix &quot; in alíneas
# ===========================================================
art105 = arts['105']
for inc in art105.get('incisos',[]):
    for al in inc.get('alineas',[]):
        if '&quot;' in al.get('texto',''):
            al['texto'] = fix_quotes(al['texto'])
print("Fix 11 done: Art 105 alíneas quotes")

# ===========================================================
# FIX 12: Art 109 inc 5 - split V and V-A
# ===========================================================
art109 = arts['109']
for i, inc in enumerate(art109['incisos']):
    txt = inc.get('texto','')
    if ' V-A as causas' in txt:
        idx = txt.find(' V-A as causas')
        inc['texto'] = txt[:idx].strip()
        va_text = 'V-A - as causas' + txt[idx+len(' V-A as causas'):].strip()
        art109['incisos'].insert(i+1, {"id":"art_109_inc_va","texto":va_text,"alineas":[]})
        renumber(art109['incisos'], 'art_109_inc_')
        print("Fix 12 done: Art 109 split V/V-A")
        break

# ===========================================================
# FIX 13: Art 111-A par2 - split incisos I and II
# ===========================================================
art111a = arts['111-A']
par2_111a = art111a['paragrafos'][1]
txt = par2_111a['texto']
idx_i  = txt.find(' I a Escola')
idx_ii = txt.find(' II o Conselho')
if idx_i > 0 and not par2_111a.get('incisos'):
    par2_111a['texto'] = txt[:idx_i].strip()
    if idx_ii > 0:
        i_text  = 'I - a Escola'  + txt[idx_i+len(' I a Escola'):idx_ii].strip()
        ii_text = 'II - o Conselho' + txt[idx_ii+len(' II o Conselho'):].strip()
        par2_111a['incisos'] = [
            {"id":"art_111_a_par_2_inc_1","texto":i_text,"alineas":[]},
            {"id":"art_111_a_par_2_inc_2","texto":ii_text,"alineas":[]},
        ]
    else:
        i_text = 'I - a Escola' + txt[idx_i+len(' I a Escola'):].strip()
        par2_111a['incisos'] = [{"id":"art_111_a_par_2_inc_1","texto":i_text,"alineas":[]}]
    print("Fix 13 done: Art 111-A par2 incisos split")

# ===========================================================
# FIX 14: Art 114 - extract incisos I-IX from caput
# ===========================================================
art114 = arts['114']
caput = art114['texto']
idx_i = caput.find(' I as ações oriundas')
if idx_i > 0:
    art114['texto'] = caput[:idx_i].strip()
    rest = caput[idx_i+2:].strip()  # skip " I"
    
    splits_114 = [
        (' II as ações que envolvam', 'II'),
        (' III as ações sobre representação', 'III'),
        (' IV os mandados de segurança', 'IV'),
        (' V os conflitos de competência', 'V'),
        (' VI as ações de indenização', 'VI'),
        (' VII as ações relativas', 'VII'),
        (' VIII a execução', 'VIII'),
        (' IX outras controvérsias', 'IX'),
    ]
    pos_114 = []
    for marker, roman in splits_114:
        idx = rest.find(marker)
        if idx >= 0:
            pos_114.append((idx, roman, marker))
    pos_114.sort()
    
    incisos_114 = []
    first_end = pos_114[0][0] if pos_114 else len(rest)
    incisos_114.append({"id":"art_114_inc_1","texto":'I - ' + rest[:first_end].strip(),"alineas":[]})
    
    for k, (pos, roman, marker) in enumerate(pos_114):
        end_pos = pos_114[k+1][0] if k+1 < len(pos_114) else len(rest)
        piece = 'as ' + rest[pos+len(marker):end_pos].strip() if rest[pos+len(marker)-2:pos+len(marker)] == 'as' else rest[pos+len(marker):end_pos].strip()
        # simpler: just take text after marker and strip
        piece_body = rest[pos:end_pos].strip()[len(marker.strip()):]
        incisos_114.append({"id":f"art_114_inc_{k+2}","texto":roman + ' - ' + piece_body.strip(),"alineas":[]})
    
    if not art114.get('incisos'):
        art114['incisos'] = []
    art114['incisos'] = incisos_114
    print(f"Fix 14 done: Art 114 {len(incisos_114)} incisos extracted")

# ===========================================================
# FIX 15: Art 115 - extract incisos I and II from caput
# ===========================================================
art115 = arts['115']
caput = art115['texto']
idx_i = caput.find(' I um quinto')
if idx_i > 0:
    art115['texto'] = caput[:idx_i].strip()
    rest = caput[idx_i+2:].strip()  # skip " I"
    idx_ii = rest.find(' II os demais')
    if idx_ii > 0:
        i_text  = 'I - '  + rest[:idx_ii].strip()
        ii_text = 'II - ' + rest[idx_ii+4:].strip()
        if not art115.get('incisos'):
            art115['incisos'] = []
        art115['incisos'] = [
            {"id":"art_115_inc_1","texto":i_text,"alineas":[]},
            {"id":"art_115_inc_2","texto":ii_text,"alineas":[]},
        ]
        print("Fix 15 done: Art 115 incisos I and II extracted")

# ===========================================================
# FIX 16: Art 130-A - extract incisos I-VI from caput
# ===========================================================
art130a = arts['130-A']
caput = art130a['texto']
idx_i = caput.find(' I o Procurador')
if idx_i > 0:
    art130a['texto'] = caput[:idx_i].strip()
    rest = caput[idx_i+2:].strip()
    
    splits_130a = [
        (' II quatro membros', 'II'),
        (' III três membros', 'III'),
        (' IV dois juízes', 'IV'),
        (' V dois advogados', 'V'),
        (' VI dois cidadãos', 'VI'),
    ]
    pos_130a = []
    for marker, roman in splits_130a:
        idx = rest.find(marker)
        if idx >= 0:
            pos_130a.append((idx, roman, marker))
    pos_130a.sort()
    
    incisos_130a = []
    first_end = pos_130a[0][0] if pos_130a else len(rest)
    incisos_130a.append({"id":"art_130_a_inc_1","texto":'I - ' + rest[:first_end].strip(),"alineas":[]})
    
    for k, (pos, roman, marker) in enumerate(pos_130a):
        end_pos = pos_130a[k+1][0] if k+1 < len(pos_130a) else len(rest)
        piece_body = rest[pos:end_pos].strip()[len(marker.strip()):]
        incisos_130a.append({"id":f"art_130_a_inc_{k+2}","texto":roman + ' - ' + piece_body.strip(),"alineas":[]})
    
    if not art130a.get('incisos'):
        art130a['incisos'] = []
    art130a['incisos'] = incisos_130a
    print(f"Fix 16 done: Art 130-A {len(incisos_130a)} incisos extracted")

# ===========================================================
# FIX 17: Art 130-A par2 - split incisos I-II from condensed text
# ===========================================================
par2_130a = art130a['paragrafos'][1]
txt = par2_130a['texto']
idx_i  = txt.find(' I zelar pela autonomia')
idx_ii = txt.find(' II zelar pela observância')
if idx_i > 0 and not par2_130a.get('incisos'):
    par2_130a['texto'] = txt[:idx_i].strip()
    if idx_ii > 0:
        i_text  = 'I - zelar pela autonomia' + txt[idx_i+len(' I zelar pela autonomia'):idx_ii].strip()
        ii_text = 'II - zelar pela observância' + txt[idx_ii+len(' II zelar pela observância'):].strip()
        par2_130a['incisos'] = [
            {"id":"art_130_a_par_2_inc_1","texto":i_text,"alineas":[]},
            {"id":"art_130_a_par_2_inc_2","texto":ii_text,"alineas":[]},
        ]
        print("Fix 17 done: Art 130-A par2 incisos split")

# ===========================================================
# FIX 18: Art 130-A par3 - split incisos I-III from condensed text
# ===========================================================
par3_130a = art130a['paragrafos'][2]
txt = par3_130a['texto']
idx_i   = txt.find(' I receber reclamações')
idx_ii  = txt.find(' II exercer funções executivas do Conselho')
idx_iii = txt.find(' III requisitar e designar membros')
if idx_i > 0 and not par3_130a.get('incisos'):
    par3_130a['texto'] = txt[:idx_i].strip()
    if idx_ii > 0 and idx_iii > 0:
        i_text   = 'I - receber reclamações'   + txt[idx_i+len(' I receber reclamações'):idx_ii].strip()
        ii_text  = 'II - exercer funções executivas do Conselho' + txt[idx_ii+len(' II exercer funções executivas do Conselho'):idx_iii].strip()
        iii_text = 'III - requisitar e designar membros' + txt[idx_iii+len(' III requisitar e designar membros'):].strip()
        par3_130a['incisos'] = [
            {"id":"art_130_a_par_3_inc_1","texto":i_text,"alineas":[]},
            {"id":"art_130_a_par_3_inc_2","texto":ii_text,"alineas":[]},
            {"id":"art_130_a_par_3_inc_3","texto":iii_text,"alineas":[]},
        ]
        print("Fix 18 done: Art 130-A par3 incisos split")

# ===========================================================
# GLOBAL: Fix remaining &quot; across all texto fields
# ===========================================================
raw_json = json.dumps(data, ensure_ascii=False)
fixed_count = raw_json.count('&quot;')
raw_json = raw_json.replace('&quot;', '"')
print(f"Global fix: replaced {fixed_count} remaining &quot; instances")

# ===========================================================
# WRITE OUTPUT
# ===========================================================
output = prefix + raw_json
with open('$HOME/mnt/Pasta_claude_oab/cf-app/constituicao.js','w',encoding='utf-8') as f:
    f.write(output)

print("\n=== ALL DONE. constituicao.js written ===")
