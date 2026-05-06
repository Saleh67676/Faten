#!/usr/bin/env python3
"""
Complete Navigation System Test
Tests both data loading and pathfinding functionality
"""

import sys
import os
import json
from pathlib import Path

# Add backend to path
sys.path.insert(0, os.path.dirname(__file__))

print("="*80)
print("UQU NAVIGATION SYSTEM - COMPREHENSIVE TEST")
print("="*80)

# ──────────────────────────────────────────────────────────────────────────────
# Phase 1: Import and initialize
# ──────────────────────────────────────────────────────────────────────────────
print("\n[1/5] Initializing Navigation Service...")
try:
    from services.navigation import NavigationService
    nav = NavigationService()
    print("✓ NavigationService imported successfully")
except Exception as e:
    print(f"✗ Failed to import: {e}")
    sys.exit(1)

# ──────────────────────────────────────────────────────────────────────────────
# Phase 2: Check data loading
# ──────────────────────────────────────────────────────────────────────────────
print("\n[2/5] Verifying data loading...")

map_count = len(nav.map_data)
node_count = len(nav.nav_graph.get('nodes', {}))
edge_count = len(nav.nav_graph.get('edges', []))

print(f"  MAP_DATA rooms: {map_count}")
print(f"  NAV_GRAPH nodes: {node_count}")
print(f"  NAV_GRAPH edges: {edge_count}")

if map_count < 10:
    print("✗ WARNING: Very few rooms loaded (expected 50+)")
if node_count < 100:
    print("✗ WARNING: Very few waypoint nodes (expected 200+)")
if edge_count < 100:
    print("✗ WARNING: Very few edges (expected 300+)")

if map_count > 0 and node_count > 0 and edge_count > 0:
    print("✓ Data loaded successfully")
else:
    print("✗ Data loading incomplete!")

# ──────────────────────────────────────────────────────────────────────────────
# Phase 3: Build graph
# ──────────────────────────────────────────────────────────────────────────────
print("\n[3/5] Building navigation graph...")
try:
    nav.build_graph()
    total_nodes = len(nav.nodes)
    total_edges = sum(len(edges) for edges in nav.adj.values())
    
    print(f"  Graph nodes: {total_nodes}")
    print(f"  Graph edges: {total_edges}")
    
    if total_nodes > 50 and total_edges > 50:
        print("✓ Graph built successfully")
    else:
        print("✗ WARNING: Graph may be incomplete")
except Exception as e:
    print(f"✗ Graph building failed: {e}")
    import traceback
    traceback.print_exc()

# ──────────────────────────────────────────────────────────────────────────────
# Phase 4: Test pathfinding
# ──────────────────────────────────────────────────────────────────────────────
print("\n[4/5] Testing pathfinding...")

if nav.map_data:
    test_cases = [
        (nav.map_data[0]['id'], nav.map_data[1]['id']) if len(nav.map_data) > 1 else None,
        (nav.map_data[0]['id'], nav.map_data[2]['id']) if len(nav.map_data) > 2 else None,
    ]
    test_cases = [t for t in test_cases if t]
    
    success_count = 0
    for from_room, to_room in test_cases:
        try:
            result = nav.find_path(from_room_id=from_room, to_room_id=to_room)
            if result:
                points = len(result.get('points', []))
                dist = result.get('distanceMeters', 0)
                print(f"  ✓ {from_room} → {to_room}: {points} waypoints, {dist}m")
                success_count += 1
            else:
                print(f"  ✗ {from_room} → {to_room}: No path found")
        except Exception as e:
            print(f"  ✗ {from_room} → {to_room}: Error - {e}")
    
    if success_count > 0:
        print(f"✓ Pathfinding working ({success_count}/{len(test_cases)} tests passed)")
    else:
        print("✗ Pathfinding failed - check room IDs and graph connectivity")
else:
    print("✗ No rooms to test")

# ──────────────────────────────────────────────────────────────────────────────
# Phase 5: Check API compatibility
# ──────────────────────────────────────────────────────────────────────────────
print("\n[5/5] Checking API schema compatibility...")

try:
    from schemas.navigation import NavRouteRequest, NavRouteResponse
    print("✓ Navigation schemas imported")
    
    # Try to create valid request
    req = NavRouteRequest(fromRoom="test", toRoom="test", fromNode="", accessible=False)
    print("✓ NavRouteRequest validates correctly")
except Exception as e:
    print(f"✗ Schema error: {e}")

# ──────────────────────────────────────────────────────────────────────────────
# Final Summary
# ──────────────────────────────────────────────────────────────────────────────
print("\n" + "="*80)
print("SUMMARY")
print("="*80)
print("""
To start the backend server:
  cd backend
  uvicorn main:app --reload --port 8000

To test the API:
  curl -X POST http://localhost:8000/api/nav/route \\
    -H "Content-Type: application/json" \\
    -d '{"fromRoom": "Room_1", "toRoom": "Room_2", "fromNode": "", "accessible": false}'

Expected frontend behavior:
  1. User selects origin and destination rooms
  2. Frontend calls NavEngine.findPath() → POST /api/nav/route
  3. Backend responds with route points and steps
  4. Frontend renders route on map
""")
print("="*80)
