import network
import socket
import json
import dht
import machine
import time

# Use only 2.4 GHz WiFi networks
SSID = 'YOUR_WIFI_SSID'
PASSWORD = 'YOUR_WIFI_PASSWORD'

sensor = dht.DHT22(machine.Pin(4))
relay = machine.Pin(5, machine.Pin.OUT)
relay.value(1)  # Active LOW — 1 = OFF physically
relay_state = 'off'

def connect_wifi():
    wlan = network.WLAN(network.STA_IF)
    wlan.active(True)
    wlan.connect(SSID, PASSWORD)
    print('Connecting to WiFi', end='')
    while not wlan.isconnected():
        print('.', end='')
        time.sleep(0.5)
    print('\nConnected! IP:', wlan.ifconfig()[0])
    return wlan.ifconfig()[0]

def get_sensor_reading():
    sensor.measure()
    return {
        'temperature': sensor.temperature(),
        'humidity': sensor.humidity()
    }

def handle_request(conn):
    global relay_state
    conn.settimeout(3.0)
    try:
        request = conn.recv(1024).decode()
        lines = request.split('\n')
        if not lines:
            return
        first_line = lines[0].strip()
        parts = first_line.split(' ')
        if len(parts) < 2:
            return
        method = parts[0]
        path = parts[1]

        if path == '/sensor' and method == 'GET':
            data = get_sensor_reading()
            body = json.dumps(data)
            response = (
                'HTTP/1.1 200 OK\r\n'
                'Content-Type: application/json\r\n'
                'Access-Control-Allow-Origin: *\r\n'
                f'Content-Length: {len(body)}\r\n'
                '\r\n' + body
            )

        elif path == '/relay' and method == 'POST':
            body_start = request.find('\r\n\r\n') + 4
            body_raw = request[body_start:].strip()
            print('Relay body received:', repr(body_raw))
            # Robust state detection — works with or without quotes
            if 'on' in body_raw:
                relay.value(0)   # Active LOW — 0 = ON
                relay_state = 'on'
            else:
                relay.value(1)   # Active LOW — 1 = OFF
                relay_state = 'off'
            body = json.dumps({'relay': relay_state})
            response = (
                'HTTP/1.1 200 OK\r\n'
                'Content-Type: application/json\r\n'
                'Access-Control-Allow-Origin: *\r\n'
                f'Content-Length: {len(body)}\r\n'
                '\r\n' + body
            )

        elif path == '/relay/status' and method == 'GET':
            body = json.dumps({'relay': relay_state})
            response = (
                'HTTP/1.1 200 OK\r\n'
                'Content-Type: application/json\r\n'
                'Access-Control-Allow-Origin: *\r\n'
                f'Content-Length: {len(body)}\r\n'
                '\r\n' + body
            )

        else:
            response = 'HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\n\r\n'

        conn.send(response.encode())

    except Exception as e:
        print('Request error:', e)
    finally:
        conn.close()

# Main
ip = connect_wifi()
addr = socket.getaddrinfo('0.0.0.0', 80)[0][-1]
s = socket.socket()
s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
s.bind(addr)
s.listen(5)
print('HTTP server listening on', ip, 'port 80')

while True:
    try:
        conn, addr = s.accept()
        handle_request(conn)
    except Exception as e:
        print('Server error:', e)