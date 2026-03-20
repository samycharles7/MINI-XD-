/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useEffect } from 'react';
import { Menu, Phone, ArrowRight, ShieldCheck, Zap, Copy, Check, LogOut, RefreshCw } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

export default function App() {
  const [phoneNumber, setPhoneNumber] = useState('');
  const [isIslandExpanded, setIsIslandExpanded] = useState(false);
  const [pairingCode, setPairingCode] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  const [isConnected, setIsConnected] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);

  useEffect(() => {
    // Cookie management
    let id = getCookie('user_id');
    if (!id || id === 'null' || id === 'undefined' || id === '') {
      try {
        id = crypto.randomUUID();
      } catch (e) {
        // Fallback for older browsers or non-secure contexts
        id = 'user-' + Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
      }
      setCookie('user_id', id, 365);
    }
    setUserId(id);
  }, []);

  useEffect(() => {
    if (userId) {
      checkStatus();
      const interval = setInterval(checkStatus, 10000);
      return () => clearInterval(interval);
    }
  }, [userId]);

  const getCookie = (name: string) => {
    const value = `; ${document.cookie}`;
    const parts = value.split(`; ${name}=`);
    if (parts.length === 2) return parts.pop()?.split(';').shift();
    return null;
  };

  const setCookie = (name: string, value: string, days: number) => {
    const date = new Date();
    date.setTime(date.getTime() + (days * 24 * 60 * 60 * 1000));
    const expires = `; expires=${date.toUTCString()}`;
    document.cookie = `${name}=${value}${expires}; path=/; SameSite=Lax`;
  };

  const checkStatus = async () => {
    if (!userId) return;
    try {
      const response = await fetch('/api/status', {
        headers: { 'x-user-id': userId }
      });
      if (!response.ok) {
        throw new Error(`Server error: ${response.status}`);
      }
      const contentType = response.headers.get('content-type');
      if (contentType && contentType.includes('application/json')) {
        const data = await response.json();
        setIsConnected(data.isConnected);
      } else {
        console.warn('Received non-JSON response from /api/status');
      }
    } catch (error) {
      console.error('Error checking status:', error);
    }
  };

  const handleLogout = async () => {
    if (!confirm('Voulez-vous vraiment déconnecter le bot ?') || !userId) return;
    setIsLoading(true);
    try {
      await fetch('/api/logout', { 
        method: 'POST',
        headers: { 'x-user-id': userId }
      });
      setIsConnected(false);
      setPairingCode(null);
      setIsIslandExpanded(false);
    } catch (error) {
      console.error('Error logging out:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleCopy = () => {
    if (pairingCode) {
      navigator.clipboard.writeText(pairingCode);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const handleGetCode = async () => {
    if (!phoneNumber || !userId) return;
    setIsLoading(true);
    setIsIslandExpanded(true);
    setPairingCode(null);
    
    try {
      const response = await fetch('/api/get-pairing-code', {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'x-user-id': userId
        },
        body: JSON.stringify({ phoneNumber })
      });
      
      const data = await response.json();
      
      if (data.code) {
        setPairingCode(data.code);
      } else {
        alert(data.error || 'Erreur lors de la génération du code');
        setIsIslandExpanded(false);
      }
    } catch (error) {
      console.error('Error getting pairing code:', error);
      alert('Impossible de contacter le serveur');
      setIsIslandExpanded(false);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-white font-sans text-zinc-900 flex flex-col relative overflow-hidden">
      
      {/* Background Subtle Gradient */}
      <div className="fixed inset-0 -z-10 bg-[radial-gradient(circle_at_top_right,_var(--tw-gradient-stops))] from-pink-50 via-white to-white" />

      {/* Top Navigation Bar (Full Width) */}
      <header className="h-20 flex items-center justify-between px-6 z-50">
        {/* Menu Button (Top Left) */}
        <button className="p-3 hover:bg-pink-50 rounded-2xl transition-colors active:scale-90">
          <Menu className="w-7 h-7 text-zinc-800" />
        </button>

        {/* Dynamic Island (Top Center) */}
        <motion.div 
          layout
          initial={false}
          animate={{
            width: isIslandExpanded ? (pairingCode ? 260 : 180) : 120,
            height: isIslandExpanded ? (pairingCode ? 60 : 40) : 36,
            borderRadius: 30
          }}
          className="bg-black flex items-center justify-center overflow-hidden cursor-pointer shadow-lg"
          onClick={() => setIsIslandExpanded(!isIslandExpanded)}
        >
          <AnimatePresence mode="wait">
            {isLoading ? (
              <motion.div 
                key="loading"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="flex items-center gap-2"
              >
                <div className="w-2 h-2 bg-pink-500 rounded-full animate-bounce" />
                <span className="text-white text-[11px] font-medium">Action...</span>
              </motion.div>
            ) : isConnected ? (
              <motion.div 
                key="connected"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="flex items-center gap-2"
              >
                <div className="w-2 h-2 bg-emerald-500 rounded-full" />
                <span className="text-white text-[11px] font-medium tracking-wide">BOT CONNECTÉ</span>
              </motion.div>
            ) : pairingCode ? (
              <motion.div 
                key="code"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="flex flex-col items-center"
              >
                <span className="text-pink-400 text-[10px] font-bold uppercase tracking-widest">Code de Jumelage</span>
                <span className="text-white text-lg font-mono font-black tracking-[0.2em]">{pairingCode}</span>
              </motion.div>
            ) : (
              <motion.div 
                key="idle"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="flex items-center gap-2"
              >
                <div className="w-2 h-2 bg-pink-500 rounded-full" />
                <span className="text-white text-[11px] font-medium tracking-wide">MINI-XD BOT</span>
              </motion.div>
            )}
          </AnimatePresence>
        </motion.div>

        {/* Profile Image (Top Right) */}
        <div className="w-12 h-12 rounded-2xl overflow-hidden border-2 border-pink-200 shadow-md transform rotate-3">
          <img 
            src="https://lieixmgdboiceopzksvu.supabase.co/storage/v1/object/public/hosted-files/9nwmikgq-1773928282038.jpg" 
            alt="Profile"
            className="w-full h-full object-cover"
            referrerPolicy="no-referrer"
          />
        </div>
      </header>

      {/* Main Content Area */}
      <main className="flex-1 flex flex-col items-center justify-center px-6 pb-12">
        
        {/* Branding Section */}
        <div className="text-center mb-12">
          <motion.div
            initial={{ scale: 0.8, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            className="inline-flex items-center gap-2 bg-pink-100 text-pink-600 px-4 py-1.5 rounded-full text-xs font-bold mb-4"
          >
            <Zap className="w-3 h-3 fill-current" />
            WHATSAPP BOT SYSTEM
          </motion.div>
          
          <motion.h1 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="text-7xl font-black text-pink-500 tracking-tighter drop-shadow-sm"
          >
            MINI-XD
          </motion.h1>
          <p className="text-zinc-500 mt-2 font-medium">Connectez votre bot en quelques secondes</p>
        </div>

        {/* Status Card */}
        {isConnected && (
          <motion.div
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            className="w-full max-w-md bg-emerald-50 border border-emerald-100 p-6 rounded-[32px] mb-8 flex items-center justify-between"
          >
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 bg-emerald-500 rounded-2xl flex items-center justify-center shadow-lg shadow-emerald-200">
                <ShieldCheck className="w-6 h-6 text-white" />
              </div>
              <div>
                <h3 className="text-emerald-900 font-bold">Bot Actif</h3>
                <p className="text-emerald-600 text-xs font-medium">Prêt à recevoir des commandes</p>
              </div>
            </div>
            <button 
              onClick={handleLogout}
              className="p-3 bg-white text-emerald-600 rounded-2xl shadow-sm hover:bg-emerald-100 transition-colors active:scale-90"
            >
              <LogOut className="w-5 h-5" />
            </button>
          </motion.div>
        )}

        {/* Pairing Code Card (Visible when code exists) */}
        <AnimatePresence>
          {pairingCode && (
            <motion.div
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 20 }}
              className="w-full max-w-md bg-pink-500 p-8 rounded-[40px] shadow-2xl shadow-pink-200 mb-8 relative overflow-hidden group"
            >
              <div className="absolute top-0 right-0 p-6 opacity-10 group-hover:opacity-20 transition-opacity">
                <Zap className="w-32 h-32 text-white" />
              </div>
              
              <div className="relative z-10 text-center">
                <span className="text-pink-100 text-xs font-bold uppercase tracking-widest mb-2 block">
                  Votre Code de Jumelage
                </span>
                <div className="flex items-center justify-center gap-4 mb-6">
                  <span className="text-white text-5xl font-mono font-black tracking-[0.15em]">
                    {pairingCode}
                  </span>
                </div>
                
                <button
                  onClick={handleCopy}
                  className="w-full bg-white text-pink-600 font-bold py-4 rounded-3xl flex items-center justify-center gap-2 shadow-lg active:scale-95 transition-all"
                >
                  {copied ? (
                    <>
                      <Check className="w-5 h-5" />
                      COPIÉ !
                    </>
                  ) : (
                    <>
                      <Copy className="w-5 h-5" />
                      COPIER LE CODE
                    </>
                  )}
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Input Card */}
        {!isConnected && (
          <motion.div 
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 }}
            className="w-full max-w-md bg-white/80 backdrop-blur-xl border border-pink-100 p-8 rounded-[40px] shadow-2xl shadow-pink-100/50"
          >
            <div className="space-y-6">
              <div className="relative">
                <label className="block text-[10px] font-bold text-pink-400 uppercase tracking-widest mb-2 ml-1">
                  Numéro de téléphone
                </label>
                <div className="relative group">
                  <div className="absolute inset-y-0 left-5 flex items-center pointer-events-none">
                    <Phone className="w-5 h-5 text-pink-400 group-focus-within:text-pink-600 transition-colors" />
                  </div>
                  <input
                    type="tel"
                    placeholder="+225 00 00 00 00 00"
                    value={phoneNumber}
                    onChange={(e) => setPhoneNumber(e.target.value)}
                    className="w-full bg-zinc-50 border-2 border-zinc-100 rounded-3xl py-5 pl-14 pr-6 focus:outline-none focus:border-pink-400 focus:bg-white transition-all text-xl font-semibold placeholder:text-zinc-300"
                  />
                </div>
              </div>

              <button
                onClick={handleGetCode}
                disabled={!phoneNumber || isLoading}
                className="w-full bg-pink-500 hover:bg-pink-600 disabled:bg-pink-200 text-white font-black py-5 rounded-3xl shadow-xl shadow-pink-200 flex items-center justify-center gap-3 transition-all active:scale-95 group"
              >
                {isLoading ? "CHARGEMENT..." : "GET PAIRING CODE"}
                {!isLoading && <ArrowRight className="w-6 h-6 group-hover:translate-x-1 transition-transform" />}
              </button>
            </div>

            <div className="mt-8 flex items-center justify-center gap-2 text-zinc-400">
              <ShieldCheck className="w-4 h-4" />
              <span className="text-[10px] font-bold uppercase tracking-tight">Sécurisé par WhatsApp Web API</span>
            </div>
          </motion.div>
        )}

        {/* Instructions */}
        {!isConnected && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.4 }}
            className="mt-12 max-w-xs text-center"
          >
            <p className="text-zinc-400 text-sm leading-relaxed">
              Ouvrez WhatsApp {'>'} Appareils connectés {'>'} Connecter un appareil {'>'} Connecter avec le numéro de téléphone.
            </p>
          </motion.div>
        )}

        {/* Refresh Button for connected state */}
        {isConnected && (
          <button 
            onClick={checkStatus}
            className="mt-8 flex items-center gap-2 text-zinc-400 hover:text-pink-500 transition-colors font-bold text-[10px] uppercase tracking-widest"
          >
            <RefreshCw className="w-3 h-3" />
            Actualiser le statut
          </button>
        )}
      </main>

      {/* Bottom Decorative Element */}
      <div className="h-12 flex justify-center items-center">
        <div className="w-32 h-1.5 bg-zinc-100 rounded-full" />
      </div>

    </div>
  );
}
