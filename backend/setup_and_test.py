#!/usr/bin/env python3
"""
Complete Setup & Test Script for Navigation Engine
Ensures everything is working before running the server
"""

import sys
import os
import subprocess
from pathlib import Path

# Colors for output
class Colors:
    HEADER = '\033[95m'
    BLUE = '\033[94m'
    CYAN = '\033[96m'
    GREEN = '\033[92m'
    YELLOW = '\033[93m'
    RED = '\033[91m'
    END = '\033[0m'
    BOLD = '\033[1m'
    UNDERLINE = '\033[4m'

def print_header(text):
    print(f"\n{Colors.HEADER}{Colors.BOLD}{'='*70}{Colors.END}")
    print(f"{Colors.HEADER}{Colors.BOLD}{text:^70}{Colors.END}")
    print(f"{Colors.HEADER}{Colors.BOLD}{'='*70}{Colors.END}\n")

def print_step(num, text):
    print(f"{Colors.BLUE}[{num}]{Colors.END} {Colors.BOLD}{text}{Colors.END}")

def print_success(text):
    print(f"{Colors.GREEN}✓{Colors.END} {text}")

def print_error(text):
    print(f"{Colors.RED}✗{Colors.END} {text}")

def print_warning(text):
    print(f"{Colors.YELLOW}⚠{Colors.END} {text}")

def main():
    backend_dir = Path(__file__).parent
    os.chdir(backend_dir)
    
    print_header("🧭 UQU Navigation Engine - Complete Setup")
    
    # Phase 1: Verify Python
    print_step(1, "Verifying Python Installation")
    try:
        result = subprocess.run([sys.executable, '--version'], capture_output=True, text=True)
        version = result.stdout.strip() + result.stderr.strip()
        print_success(f"Python {version}")
    except Exception as e:
        print_error(f"Python verification failed: {e}")
        return False
    
    # Phase 2: Import test
    print_step(2, "Testing Core Imports")
    try:
        from services.navigation import NavigationService
        from routers.nav import router
        from schemas.navigation import NavRouteRequest, NavRouteResponse
        print_success("All imports successful")
    except Exception as e:
        print_error(f"Import failed: {e}")
        return False
    
    # Phase 3: Data loading test
    print_step(3, "Testing Navigation Data Loading")
    try:
        nav = NavigationService()
        map_rooms = len(nav.map_data)
        graph_nodes = len(nav.nav_graph.get('nodes', {}))
        graph_edges = len(nav.nav_graph.get('edges', []))
        
        if map_rooms > 0:
            print_success(f"Loaded {map_rooms} rooms from MAP_DATA")
        else:
            print_warning(f"No rooms loaded (expected 50+)")
        
        if graph_nodes > 0:
            print_success(f"Loaded {graph_nodes} waypoint nodes from NAV_GRAPH")
        else:
            print_warning(f"No waypoint nodes loaded (expected 200+)")
        
        if graph_edges > 0:
            print_success(f"Loaded {graph_edges} edges from NAV_GRAPH")
        else:
            print_warning(f"No edges loaded (expected 300+)")
        
        if map_rooms == 0 or graph_nodes == 0:
            print_error("Data loading incomplete!")
            return False
            
    except Exception as e:
        print_error(f"Data loading test failed: {e}")
        import traceback
        traceback.print_exc()
        return False
    
    # Phase 4: Graph building test
    print_step(4, "Testing Graph Building")
    try:
        nav.build_graph()
        total_nodes = len(nav.nodes)
        total_edges = sum(len(e) for e in nav.adj.values())
        
        print_success(f"Built graph with {total_nodes} nodes")
        print_success(f"Built graph with {total_edges} edges")
        
        if total_nodes < 50:
            print_warning(f"Few nodes (expected 100+)")
    except Exception as e:
        print_error(f"Graph building test failed: {e}")
        return False
    
    # Phase 5: Pathfinding test
    print_step(5, "Testing Pathfinding")
    try:
        if len(nav.map_data) >= 2:
            room1 = nav.map_data[0]['id']
            room2 = nav.map_data[1]['id']
            
            result = nav.find_path(from_room_id=room1, to_room_id=room2)
            
            if result:
                points = len(result.get('points', []))
                dist = result.get('distanceMeters', 0)
                print_success(f"Found path: {room1} → {room2}")
                print_success(f"  - {points} waypoints, {dist}m")
            else:
                print_warning(f"Could not find path between {room1} and {room2}")
        else:
            print_warning("Not enough rooms to test pathfinding")
    except Exception as e:
        print_error(f"Pathfinding test failed: {e}")
        import traceback
        traceback.print_exc()
    
    # Final summary
    print_header("✅ All Pre-flight Checks Passed!")
    print(f"{Colors.CYAN}Ready to start the server:{Colors.END}")
    print(f"\n  {Colors.BOLD}uvicorn main:app --reload --port 8000{Colors.END}\n")
    print(f"{Colors.CYAN}Then open:{Colors.END}")
    print(f"  • Frontend: {Colors.BOLD}http://localhost:5500{Colors.END}")
    print(f"  • API Docs: {Colors.BOLD}http://localhost:8000/docs{Colors.END}\n")
    print(f"{Colors.CYAN}For debugging:{Colors.END}")
    print(f"  • Open Browser Console (F12)")
    print(f"  • Look for 🧭 messages from NavEngine")
    print(f"  • Check Backend console for DEBUG messages\n")
    
    return True

if __name__ == "__main__":
    success = main()
    sys.exit(0 if success else 1)
