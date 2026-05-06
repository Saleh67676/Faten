import os
import httpx
import asyncio
from dotenv import load_dotenv

load_dotenv("backend/.env")

async def test_nvidia():
    api_key = os.getenv("NVIDIA_API_KEY")
    model = os.getenv("NVIDIA_MODEL", "moonshotai/kimi-k2-instruct")
    
    print(f"Testing NVIDIA NIM API...")
    print(f"Model: {model}")
    
    url = f"https://integrate.api.nvidia.com/v1/chat/completions"
    
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json"
    }
    
    payload = {
        "model": model,
        "messages": [{"role": "user", "content": "مرحبا، هل تعمل؟"}],
        "temperature": 0.5,
        "top_p": 1,
        "max_tokens": 1024
    }
    
    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.post(url, headers=headers, json=payload)
            response.raise_for_status()
            data = response.json()
            print("\n--- RESPONSE ---")
            print(data["choices"][0]["message"]["content"])
            print("--- END ---\n")
            print("[SUCCESS] Connection successful!")
    except Exception as e:
        print(f"\n[ERROR] Request failed: {e}")
        if hasattr(e, 'response') and e.response:
            print(f"Details: {e.response.text}")

if __name__ == "__main__":
    asyncio.run(test_nvidia())
