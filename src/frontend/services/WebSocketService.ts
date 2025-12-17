import { ServerMessage, ClientMessage } from '../../poker/types';

type MessageHandler = (msg: ServerMessage) => void;

export class WebSocketService {
    private ws: WebSocket | null = null;
    private listeners: MessageHandler[] = [];
    private queue: ClientMessage[] = [];
    private isConnected: boolean = false;

    public connect(onMessage: MessageHandler) {
        this.listeners.push(onMessage);

        if (this.ws) {
            // Already connected or connecting
            return () => {
                this.listeners = this.listeners.filter(cb => cb !== onMessage);
            };
        }

        // Reset state before new connection
        this.isConnected = false;

        // Get Telegram InitData
        // @ts-ignore
        const initData = window.Telegram?.WebApp?.initData;
        const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
        const host = window.location.host;
        const url = `${protocol}://${host}/ws?initData=${encodeURIComponent(initData)}`;

        console.log('Connecting to WS:', url);
        this.ws = new WebSocket(url);

        this.ws.onopen = () => {
            console.log('WS Open');
            this.isConnected = true;
            this.flushQueue();
        };

        this.ws.onmessage = (event) => {
            try {
                const msg = JSON.parse(event.data) as ServerMessage;
                this.listeners.forEach(cb => cb(msg));
            } catch (e) {
                console.error('WS Parse Error', e);
            }
        };

        this.ws.onclose = () => {
            console.log('WS Close');
            this.isConnected = false;
            this.ws = null;
            // Reconnect logic
            setTimeout(() => {
                if(this.listeners.length > 0) this.connect(this.listeners[0]);
            }, 3000);
        };

        this.ws.onerror = (err) => {
             console.error('WS Error', err);
        };

        return () => {
            this.listeners = this.listeners.filter(cb => cb !== onMessage);
            // Close if no listeners left
            if (this.listeners.length === 0 && this.ws) {
                this.isConnected = false; // Immediately mark as disconnected
                this.ws.close();
                this.ws = null;
            }
        };
    }

    public send(msg: ClientMessage) {
        // Double check readiness
        if (this.isConnected && this.ws && this.ws.readyState === WebSocket.OPEN) {
            try {
                this.ws.send(JSON.stringify(msg));
            } catch (e) {
                console.error('WS Send Error', e);
                this.queue.push(msg);
            }
        } else {
            this.queue.push(msg);
        }
    }

    private flushQueue() {
        while (this.queue.length > 0 && this.isConnected && this.ws && this.ws.readyState === WebSocket.OPEN) {
            const msg = this.queue.shift();
            if(msg) {
                try {
                    this.ws.send(JSON.stringify(msg));
                } catch(e) {
                    console.error('WS Flush Error', e);
                    this.queue.unshift(msg); // Put back
                    break;
                }
            }
        }
    }
}

// Singleton instance
export const webSocketService = new WebSocketService();
