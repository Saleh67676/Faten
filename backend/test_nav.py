#!/usr/bin/env python3
"""Test navigation endpoint"""

import requests
import json

# Test the navigation endpoint
BASE_URL = "http://localhost:8000"

# Test case 1: Room to Room
test_cases = [
    {
        "name": "Room 1 to Room 2",
        "fromRoom": "Room_1",
        "toRoom": "Room_2",
        "accessible": False
    },
    {
        "name": "Room 10 to Room 20",
        "fromRoom": "Room_10",
        "toRoom": "Room_20",
        "accessible": False
    },
]

for test in test_cases:
    print(f"\n{'='*60}")
    print(f"Testing: {test['name']}")
    print(f"Request: {test}")
    print('='*60)
    
    try:
        response = requests.post(
            f"{BASE_URL}/api/nav/route",
            json=test,
            timeout=5
        )
        
        print(f"Status Code: {response.status_code}")
        
        if response.status_code == 200:
            data = response.json()
            print(f"✓ Path found!")
            print(f"  - Distance: {data.get('distanceMeters')} meters")
            print(f"  - Time: {data.get('estimatedTime')}")
            print(f"  - Waypoints: {len(data.get('points', []))}")
            print(f"  - Steps: {len(data.get('steps', []))}")
        else:
            print(f"✗ Error: {response.status_code}")
            print(f"  Response: {response.json()}")
    
    except requests.exceptions.ConnectionError:
        print("✗ Connection Error: Backend not running at", BASE_URL)
        break
    except Exception as e:
        print(f"✗ Error: {e}")

print("\n" + "="*60)
print("Test completed!")
