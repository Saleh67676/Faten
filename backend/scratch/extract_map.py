import json
import re

def extract_js_variable(js_content, var_name):
    pattern = rf"window\.{var_name}\s*=\s*(.*?)($|window\.|\/\/|;)"
    match = re.search(pattern, js_content, re.DOTALL)
    if match:
        json_str = match.group(1).strip().rstrip(';')
        # Very crude fix for potential trailing commas or other JS-isms
        # But let's hope it's clean JSON as it looks in the file
        try:
            return json.loads(json_str)
        except:
            # Fallback for complex structure
            return None
    return None

# Manually extract based on known structure if regex fails
with open(r'c:\Users\M4SHi\Desktop\uqu_upgrade (5)\uqu_upgrade\assets\map-data.js', 'r', encoding='utf-8') as f:
    content = f.read()

# MAP_DATA starts at window.MAP_DATA = [ and ends before // Navigation Graph
map_data_start = content.find('window.MAP_DATA =') + 17
map_data_end = content.find('// =================================================================', map_data_start)
map_data_str = content[map_data_start:map_data_end].strip().rstrip(';')
map_data = json.loads(map_data_str)

# NAV_GRAPH starts at window.NAV_GRAPH = { and ends at the end of the file
nav_graph_start = content.find('window.NAV_GRAPH =') + 18
nav_graph_end = content.rfind('};') + 1
if nav_graph_end == 0: nav_graph_end = len(content)
nav_graph_str = content[nav_graph_start:nav_graph_end].strip().rstrip(';')
nav_graph = json.loads(nav_graph_str)

with open(r'c:\Users\M4SHi\Desktop\uqu_upgrade (5)\uqu_upgrade\backend\data\map_data.json', 'w', encoding='utf-8') as f:
    json.dump(map_data, f, ensure_ascii=False, indent=2)

with open(r'c:\Users\M4SHi\Desktop\uqu_upgrade (5)\uqu_upgrade\backend\data\nav_graph.json', 'w', encoding='utf-8') as f:
    json.dump(nav_graph, f, ensure_ascii=False, indent=2)

print("Extraction successful")
