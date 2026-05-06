#!/usr/bin/env python3
"""Debug navigation data loading"""

import os
import sys
import json

# Add backend to path
sys.path.insert(0, os.path.dirname(__file__))

from services.navigation import NavigationService

print("="*70)
print("NAVIGATION DATA LOADER DEBUG")
print("="*70)

nav = NavigationService()

print(f"\n1. Data Loaded:")
print(f"   - MAP_DATA rooms: {len(nav.map_data)}")
print(f"   - NAV_GRAPH nodes: {len(nav.nav_graph.get('nodes', {}))}")
print(f"   - NAV_GRAPH edges: {len(nav.nav_graph.get('edges', []))}")

if nav.map_data:
    print(f"\n2. Sample Rooms:")
    for room in nav.map_data[:3]:
        doors = room.get("doors", [])
        print(f"   - {room['id']} ({room['label']}): {len(doors)} doors")
        if doors:
            print(f"      Door 1: x={doors[0]['x']}, y={doors[0]['y']}")

if nav.nav_graph.get("nodes"):
    print(f"\n3. Sample Waypoints:")
    for i, (node_id, node_data) in enumerate(list(nav.nav_graph.get("nodes", {}).items())[:3]):
        print(f"   - {node_id}: x={node_data.get('x')}, y={node_data.get('y')}, type={node_data.get('type')}")

print(f"\n4. Building graph...")
nav.build_graph()

print(f"   - Total nodes in graph: {len(nav.nodes)}")
print(f"   - Total edges in graph: {sum(len(edges) for edges in nav.adj.values())}")

# Test pathfinding
print(f"\n5. Testing pathfinding:")
if len(nav.map_data) >= 2:
    room1_id = nav.map_data[0]['id']
    room2_id = nav.map_data[1]['id']
    
    print(f"   - Finding path from {room1_id} to {room2_id}...")
    
    result = nav.find_path(from_room_id=room1_id, to_room_id=room2_id)
    
    if result:
        print(f"   ✓ Path found!")
        print(f"     - Waypoints: {len(result.get('points', []))}")
        print(f"     - Distance: {result.get('distanceMeters')} meters")
        print(f"     - Time: {result.get('estimatedTime')}")
    else:
        print(f"   ✗ No path found!")
        print(f"     - Start node: {nav.get_node_for_room(room1_id)}")
        print(f"     - End node: {nav.get_node_for_room(room2_id)}")

print("\n" + "="*70)
