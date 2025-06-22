import requests
import os
import time
import hashlib
import json

CACHE_DIR = os.path.expanduser('~/.halom/cache')

def fetch_json(url: str):
    """
    Fetches JSON data from a URL, using a local cache to avoid repeated requests.
    The cache expires after 24 hours (86400 seconds).
    """
    os.makedirs(CACHE_DIR, exist_ok=True)
    
    # Create a hash of the URL to use as a filename
    h = hashlib.sha256(url.encode()).hexdigest()
    f = os.path.join(CACHE_DIR, f'{h}.json')
    
    # Check if a valid cache file exists
    if os.path.exists(f) and time.time() - os.path.getmtime(f) < 86400:
        print(f"Loading from cache: {url}")
        with open(f, 'r') as file:
            return json.load(file)
            
    # If no valid cache, fetch from network
    print(f"Fetching from network: {url}")
    try:
        response = requests.get(url, timeout=30)
        response.raise_for_status()  # Raise an exception for bad status codes
        data = response.json()
        
        # Save to cache
        with open(f, 'w') as file:
            json.dump(data, file)
            
        return data
    except requests.exceptions.RequestException as e:
        print(f"Error fetching {url}: {e}")
        return None

if __name__ == '__main__':
    # Example usage with a Eurostat URL from the project description (conceptual)
    # Note: A real SDMX URL would be more complex.
    test_url = "http://ec.europa.eu/eurostat/wdds/rest/data/v2.1/json/en/tesco030?since=2020"
    data = fetch_json(test_url)
    if data:
        print("Successfully fetched data.")
        # print(json.dumps(data, indent=2)) 