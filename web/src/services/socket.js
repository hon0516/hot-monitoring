import { API_BASE } from './api';

export function createSocketHandlers({ onHotspotNew, onScanItem, onNotification, onLatestScan, onStateChange }) {
  let socket = null;

  const connect = () => {
    const wsUrl = API_BASE.replace(/^http/, 'ws') + '/ws';
    socket = new WebSocket(wsUrl);

    socket.addEventListener('open', () => {
      onStateChange?.('connected');
    });

    socket.addEventListener('close', () => {
      onStateChange?.('disconnected');
      setTimeout(connect, 4000);
    });

    socket.addEventListener('error', () => {
      onStateChange?.('error');
    });

    socket.addEventListener('message', (event) => {
      const message = JSON.parse(event.data);
      if (message.event === 'hotspot:new') onHotspotNew?.(message.payload);
      if (message.event === 'scan:item') onScanItem?.(message.payload);
      if (message.event === 'notification') onNotification?.(message.payload);
      if (message.event === 'scan:latest') onLatestScan?.(message.payload);
    });
  };

  connect();

  return {
    subscribe(keywords) {
      if (socket?.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ event: 'subscribe', payload: { keywords } }));
      }
    }
  };
}
