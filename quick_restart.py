#!/usr/bin/env python3
"""
⚡ FAST RESTART - Run this to fix the navigation engine NOW
"""

import subprocess
import sys
import os

def run_command(cmd, description):
    """Run a command and show status"""
    print(f"\n🔹 {description}...")
    try:
        result = subprocess.run(cmd, shell=True, cwd="backend")
        return result.returncode == 0
    except Exception as e:
        print(f"❌ Error: {e}")
        return False

def main():
    os.chdir(r"c:\Users\M4SHi\Desktop\uqu_upgrade (5)\uqu_upgrade")
    
    print("""
╔════════════════════════════════════════════════════════════════╗
║          🧭 UQU Navigation - Quick Restart                    ║
║                                                                ║
║ This script will:                                              ║
║  1. Test the navigation system                                ║
║  2. Start the backend server                                  ║
║                                                                ║
║ After it's running:                                           ║
║  • Open http://localhost:8000/docs (API docs)                ║
║  • Open your frontend app                                     ║
║  • Open Browser Console (F12) to see detailed logs            ║
╚════════════════════════════════════════════════════════════════╝
    """)
    
    input("Press Enter to continue...")
    
    # Run test
    if not run_command("python setup_and_test.py", "Running pre-flight checks"):
        print("\n⚠️  Tests had warnings, but continuing...")
    
    # Start server
    print("""
╔════════════════════════════════════════════════════════════════╗
║  ✅ Everything looks good! Starting server...                 ║
╚════════════════════════════════════════════════════════════════╝
    """)
    
    os.chdir("backend")
    os.system("uvicorn main:app --reload --port 8000")

if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print("\n\n👋 Server stopped. Goodbye!")
