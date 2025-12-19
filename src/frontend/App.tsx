import React, { useState, useEffect } from 'react';
import { LobbyView } from './views/LobbyView';
import { GameView } from './views/GameView';
import { BlindStructure } from './types';
import { preloadAssets } from './utils/AssetLoader';

// Declare Telegram WebApp type globally
declare global {
  interface Window {
    Telegram: {
      WebApp: {
        ready: () => void;
        expand: () => void;
        enableClosingConfirmation: () => void;
        MainButton: {
          show: () => void;
          hide: () => void;
          setText: (text: string) => void;
          onClick: (cb: () => void) => void;
        };
        initDataUnsafe: {
          user?: {
            id: number;
            first_name: string;
            last_name?: string;
            username?: string;
            photo_url?: string;
          }
        }
      }
    }
  }
}

const App: React.FC = () => {
  const [currentView, setCurrentView] = useState<'lobby' | 'game'>('lobby');
  const [activeLobbyId, setActiveLobbyId] = useState<number | null>(null);
  const [currentBlinds, setCurrentBlinds] = useState<BlindStructure | null>(null);
  const [userAvatar, setUserAvatar] = useState<string | null>(null);

  useEffect(() => {
    // Initialize Telegram WebApp
    if (window.Telegram?.WebApp) {
      window.Telegram.WebApp.ready();
      window.Telegram.WebApp.expand();
      window.Telegram.WebApp.enableClosingConfirmation();

      const user = window.Telegram.WebApp.initDataUnsafe.user;
      if (user && user.photo_url) {
          setUserAvatar(user.photo_url);
      }
    }
    // Preload Assets
    preloadAssets();
  }, []);

  const handleJoinGame = (lobbyId: number, blinds: BlindStructure) => {
    setActiveLobbyId(lobbyId);
    setCurrentBlinds(blinds);
    setCurrentView('game');
  };

  const handleLeaveGame = () => {
    setActiveLobbyId(null);
    setCurrentBlinds(null);
    setCurrentView('lobby');
  };

  return (
    <div className="antialiased text-white h-full min-h-screen">
      {currentView === 'lobby' && (
        <LobbyView onJoinGame={handleJoinGame} userAvatar={userAvatar} />
      )}

      {currentView === 'game' && activeLobbyId && currentBlinds && (
        <GameView
          lobbyId={activeLobbyId}
          blindStructure={currentBlinds}
          onLeave={handleLeaveGame}
          userAvatar={userAvatar}
        />
      )}
    </div>
  );
};

export default App;