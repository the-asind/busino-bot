import React, { useState, useEffect } from 'react';
import { BLIND_STRUCTURES } from '../constants';
import { BlindStructure, Lobby, ServerMessage } from '../types';
import { webSocketService } from '../services/WebSocketService';

interface LobbyViewProps {
  onJoinGame: (lobbyId: number, blinds: BlindStructure) => void;
}

export const LobbyView: React.FC<LobbyViewProps> = ({ onJoinGame }) => {
  const [activeTab, setActiveTab] = useState<'list' | 'create'>('list');
  const [lobbies, setLobbies] = useState<Lobby[]>([]);
  const [error, setError] = useState<string | null>(null);

  // Create Form State
  const [newGameName, setNewGameName] = useState('');
  const [blindIndex, setBlindIndex] = useState(0);
  const [isPrivate, setIsPrivate] = useState(false);
  const [password, setPassword] = useState('');

  // Password Prompt for Join
  const [joinPassword, setJoinPassword] = useState('');
  const [joiningLobbyId, setJoiningLobbyId] = useState<number | null>(null);

  useEffect(() => {
    // Connect to WS and listen for lobby list
    const cleanup = webSocketService.connect((msg: ServerMessage) => {
        if (msg.type === 'LOBBY_LIST') {
            setLobbies(msg.payload);
        } else if (msg.type === 'JOIN_SUCCESS') {
            const lobbyId = msg.payload.lobbyId;
            // Find blinds for this lobby
            // Since we joined, we need to know blinds.
            // If we created, we know. If we joined existing, we look up in lobbies list.
            const lobby = lobbies.find(l => l.id === lobbyId);
            const createdBlinds = BLIND_STRUCTURES[blindIndex]; // Fallback if creation
            onJoinGame(lobbyId, lobby ? lobby.blinds : createdBlinds);
        } else if (msg.type === 'ERROR') {
            setError(msg.payload.error);
            setTimeout(() => setError(null), 3000);
        }
    });

    // Request Lobby List
    webSocketService.send({ type: 'LIST_LOBBIES' });
    const interval = setInterval(() => {
         webSocketService.send({ type: 'LIST_LOBBIES' });
    }, 5000);

    return () => {
        clearInterval(interval);
        cleanup();
    };
  }, [lobbies, blindIndex]);

  const handleCreate = (e: React.FormEvent) => {
    e.preventDefault();
    webSocketService.send({
        type: 'CREATE',
        name: newGameName,
        blindsIndex: blindIndex,
        password: isPrivate ? password : undefined
    });
  };

  const handleJoinRequest = (lobby: Lobby) => {
      if (lobby.isPrivate) {
          setJoiningLobbyId(lobby.id);
      } else {
          webSocketService.send({ type: 'JOIN', lobbyId: lobby.id });
      }
  };

  const submitJoinWithPassword = () => {
      if (joiningLobbyId !== null) {
          webSocketService.send({ type: 'JOIN', lobbyId: joiningLobbyId, password: joinPassword });
          setJoiningLobbyId(null);
          setJoinPassword('');
      }
  }

  return (
    <div className="min-h-screen bg-slate-900 pb-10 relative">
        {error && (
            <div className="fixed top-20 left-1/2 transform -translate-x-1/2 bg-red-600 text-white px-6 py-3 rounded-full shadow-xl z-[100] font-bold animate-bounce">
                ⚠️ {error}
            </div>
        )}

        {joiningLobbyId !== null && (
            <div className="fixed inset-0 bg-black/80 z-[60] flex items-center justify-center p-4">
                <div className="bg-slate-800 p-6 rounded-xl w-full max-w-sm border border-slate-700">
                    <h3 className="text-xl font-bold text-white mb-4">Введите пароль</h3>
                    <input
                        type="password"
                        value={joinPassword}
                        onChange={(e) => setJoinPassword(e.target.value)}
                        className="w-full bg-slate-900 border border-slate-600 rounded-lg p-3 text-white mb-4"
                        placeholder="********"
                    />
                    <div className="flex gap-3">
                        <button onClick={() => setJoiningLobbyId(null)} className="flex-1 bg-slate-700 text-white py-2 rounded-lg font-bold">Отмена</button>
                        <button onClick={submitJoinWithPassword} className="flex-1 bg-green-600 text-white py-2 rounded-lg font-bold">Войти</button>
                    </div>
                </div>
            </div>
        )}

      {/* Top Bar */}
      <div className="bg-slate-800 p-4 shadow-lg sticky top-0 z-50">
        <h1 className="text-xl font-bold text-center bg-gradient-to-r from-yellow-400 to-yellow-600 bg-clip-text text-transparent">
          BUSINO POKER
        </h1>
        <div className="flex gap-4 mt-4 bg-slate-700/50 p-1 rounded-xl">
          <button
            onClick={() => setActiveTab('list')}
            className={`flex-1 py-2 text-sm font-bold rounded-lg transition-all ${activeTab === 'list' ? 'bg-slate-600 text-white shadow' : 'text-slate-400'}`}
          >
            Список столов
          </button>
          <button
            onClick={() => setActiveTab('create')}
            className={`flex-1 py-2 text-sm font-bold rounded-lg transition-all ${activeTab === 'create' ? 'bg-slate-600 text-white shadow' : 'text-slate-400'}`}
          >
            Создать стол
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="p-4">

        {/* LOBBY LIST */}
        {activeTab === 'list' && (
          <div className="space-y-3">
            {lobbies.map(lobby => (
              <div key={lobby.id} className="bg-slate-800 border border-slate-700 rounded-xl p-4 flex justify-between items-center shadow-sm active:scale-[0.99] transition-transform">
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="font-bold text-white text-lg">{lobby.name}</h3>
                    {lobby.isPrivate && <span className="text-xs bg-red-900/50 text-red-300 px-1.5 py-0.5 rounded border border-red-800">🔒 Приватный</span>}
                  </div>
                  <div className="text-slate-400 text-xs mt-1 flex gap-3">
                    <span className="flex items-center gap-1">
                       👥 {lobby.playersCount}/{lobby.maxPlayers}
                    </span>
                    <span className="flex items-center gap-1 text-yellow-500 font-medium">
                       💰 Блайнды: {lobby.blinds.label}
                    </span>
                  </div>
                </div>
                <button
                  onClick={() => handleJoinRequest(lobby)}
                  className="bg-green-600 hover:bg-green-700 text-white px-5 py-2 rounded-lg font-bold text-sm shadow-lg border-b-2 border-green-800 active:border-b-0 active:translate-y-[2px]"
                >
                  ИГРАТЬ
                </button>
              </div>
            ))}

            {lobbies.length === 0 && (
               <div className="text-center text-slate-500 mt-10">Нет активных столов. Создайте свой!</div>
            )}
          </div>
        )}

        {/* CREATE FORM */}
        {activeTab === 'create' && (
          <form onSubmit={handleCreate} className="bg-slate-800 border border-slate-700 rounded-xl p-5 space-y-6">

            <div>
              <label className="block text-slate-400 text-xs font-bold uppercase mb-2">Название стола</label>
              <input
                type="text"
                value={newGameName}
                onChange={(e) => setNewGameName(e.target.value)}
                placeholder="Пример: Пятничный покер"
                required
                className="w-full bg-slate-900 border border-slate-600 rounded-lg p-3 text-white focus:outline-none focus:border-yellow-500 transition-colors"
              />
            </div>

            <div>
              <div className="flex justify-between mb-2">
                 <label className="text-slate-400 text-xs font-bold uppercase">Ставки (Блайнды)</label>
                 <span className="text-yellow-400 font-bold">{BLIND_STRUCTURES[blindIndex].label}</span>
              </div>
              <input
                type="range"
                min="0"
                max={BLIND_STRUCTURES.length - 1}
                step="1"
                value={blindIndex}
                onChange={(e) => setBlindIndex(parseInt(e.target.value))}
                className="w-full h-2 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-yellow-500"
              />
              <div className="flex justify-between text-[10px] text-slate-500 mt-1">
                <span>Низк.</span>
                <span>Выс.</span>
              </div>
            </div>

            <div className="flex items-center gap-3">
              <div
                onClick={() => setIsPrivate(!isPrivate)}
                className={`w-12 h-6 rounded-full p-1 cursor-pointer transition-colors ${isPrivate ? 'bg-green-500' : 'bg-slate-600'}`}
              >
                <div className={`w-4 h-4 bg-white rounded-full shadow-md transform transition-transform ${isPrivate ? 'translate-x-6' : 'translate-x-0'}`}></div>
              </div>
              <span className="text-slate-300 text-sm font-medium">Приватный стол (Пароль)</span>
            </div>

            {isPrivate && (
               <div className="animate-fade-in">
                  <label className="block text-slate-400 text-xs font-bold uppercase mb-2">Пароль</label>
                  <input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Введите пароль"
                    className="w-full bg-slate-900 border border-slate-600 rounded-lg p-3 text-white focus:outline-none focus:border-yellow-500 transition-colors"
                  />
               </div>
            )}

            <button
              type="submit"
              className="w-full bg-gradient-to-r from-yellow-500 to-orange-600 hover:from-yellow-400 hover:to-orange-500 text-white font-bold py-4 rounded-xl shadow-lg transform active:scale-[0.98] transition-all"
            >
              СОЗДАТЬ И ВОЙТИ
            </button>
          </form>
        )}
      </div>
    </div>
  );
};
