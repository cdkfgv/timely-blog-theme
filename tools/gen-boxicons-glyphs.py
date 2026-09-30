import re, json

css = open(r'C:////Users////EDY////AppData////Local////Temp////bx.css', encoding='utf-8').read()
# 形如 .bxs-shower:before{content:"\ef45"}
pairs = re.findall(r'\.((?:bx|bxs|bxl)-[a-z0-9-]+):before\{content:"\\([0-9a-fA-F]+)"\}', css)
print('匹配到', len(pairs), '个图标')
glyphs = {name: '\\' + code for name, code in pairs}
print('样例:', list(glyphs.items())[:3])
for probe in ['bxs-shower', 'bx-note', 'bx-pen', 'bxs-coffee-bean', 'bxs-palette', 'bx-universal-access']:
    print(f'  {probe}: {glyphs.get(probe, "(缺失!)")}')

out = r'D:////TimelyBlogTheme////boxicons-glyphs.json'
json.dump(glyphs, open(out, 'w', encoding='utf-8'), ensure_ascii=False, indent=0)
print('written ->', out)
