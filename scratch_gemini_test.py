import urllib.request, urllib.error, json
import sys

key = 'AIzaSyBEzmNHO68H6G6ZJRqJX0uepwUPayEu-Jo'

def test_model(model_name):
    url = f'https://generativelanguage.googleapis.com/v1beta/models/{model_name}:generateContent?key={key}'
    data = json.dumps({'contents':[{'parts':[{'text':'hi'}]}]}).encode('utf-8')
    req = urllib.request.Request(url, data=data, headers={'Content-Type':'application/json'})
    try:
        res = urllib.request.urlopen(req)
        print(f'{model_name}: 200 OK')
    except urllib.error.HTTPError as e:
        print(f'{model_name}: HTTP {e.code}')
    except Exception as e:
        print(f'{model_name}: Error {e}')

for m in [
    'gemini-1.5-flash', 
    'gemini-1.5-flash-latest', 
    'gemini-pro', 
    'gemini-1.5-pro-latest', 
    'gemini-1.0-pro', 
    'gemini-1.5-flash-8b',
    'gemini-2.0-flash',
    'gemini-3-flash-preview']:
    test_model(m)
