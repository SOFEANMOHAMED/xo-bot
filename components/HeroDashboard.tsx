import React, { useState, useEffect } from 'react';
import { MessageCircle, TrendingUp, Shield, Zap, CheckCircle } from 'lucide-react';

interface HeroDashboardProps {
    mousePosition: { x: number; y: number };
}

const HeroDashboard: React.FC<HeroDashboardProps> = ({ mousePosition }) => {
    const [typingStep, setTypingStep] = useState(0);

    // Parallax helper
    const getParallaxStyle = (depth: number) => ({
        transform: `translate(${mousePosition.x * depth}px, ${mousePosition.y * depth}px)`,
        transition: 'transform 0.1s ease-out',
    });

    // Simulated live conversation
    useEffect(() => {
        const interval = setInterval(() => {
            setTypingStep((prev) => (prev + 1) % 4);
        }, 3000);
        return () => clearInterval(interval);
    }, []);

    return (
        <div className="relative mx-auto max-w-5xl mt-20 perspective-1000">
            {/* 3D Glass Container */}
            <div
                className="relative rounded-3xl overflow-hidden bg-gradient-to-br from-slate-900/60 via-slate-800/60 to-slate-900/60 border border-t-white/20 border-l-white/10 border-r-black/20 border-b-black/40 backdrop-blur-xl shadow-2xl z-10 aspect-video md:aspect-[16/9] transform transition-transform duration-500 hover:scale-[1.01]"
                style={{
                    boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.5), inset 0 0 0 1px rgba(255, 255, 255, 0.1)'
                }}
            >
                {/* Top Bar */}
                <div className="absolute top-0 left-0 w-full h-10 bg-white/5 border-b border-white/5 flex items-center px-4 gap-2 z-20">
                    <div className="flex gap-2">
                        <div className="w-3 h-3 rounded-full bg-red-500/80 shadow-glow-red"></div>
                        <div className="w-3 h-3 rounded-full bg-yellow-500/80 shadow-glow-yellow"></div>
                        <div className="w-3 h-3 rounded-full bg-green-500/80 shadow-glow-green"></div>
                    </div>
                    <div className="mx-auto w-1/3 h-2 bg-white/10 rounded-full"></div>
                </div>

                {/* Inner Content - The "Stage" */}
                <div className="absolute inset-0 top-10 flex items-center justify-center overflow-hidden">

                    {/* Animated Grid Floor */}
                    <div className="absolute bottom-0 w-[200%] h-1/2 bg-[linear-gradient(to_right,rgba(99,102,241,0.1)_1px,transparent_1px),linear-gradient(to_bottom,rgba(99,102,241,0.1)_1px,transparent_1px)] bg-[size:40px_40px] [transform:rotateX(60deg)_translateY(-20px)] animate-grid-flow pointer-events-none opacity-30"></div>

                    {/* Central AI Core / Robot Abstract */}
                    <div className="relative z-10" style={getParallaxStyle(0.02)}>
                        <div className="relative w-40 h-40 md:w-56 md:h-56">
                            {/* Core Glow */}
                            <div className="absolute inset-0 bg-brand/30 rounded-full blur-[60px] animate-pulse-slow"></div>

                            {/* Robot Head / Core */}
                            <div className="relative w-full h-full bg-gradient-to-b from-slate-700 to-slate-900 rounded-full border border-white/10 shadow-2xl flex items-center justify-center overflow-hidden group">
                                <div className="absolute inset-0 bg-[radial-gradient(circle_at_30%_30%,rgba(255,255,255,0.1),transparent)]"></div>

                                {/* Face / Screen */}
                                <div className="w-3/4 h-1/2 bg-black rounded-2xl border border-brand/30 flex items-center justify-center relative overflow-hidden">
                                    <div className="absolute inset-0 bg-brand/10 animate-scanline"></div>
                                    <div className="flex gap-4">
                                        {/* Eyes */}
                                        <div className="w-8 h-2 bg-cyan-400 rounded-full shadow-[0_0_15px_rgba(34,211,238,0.8)] animate-blink"></div>
                                        <div className="w-8 h-2 bg-cyan-400 rounded-full shadow-[0_0_15px_rgba(34,211,238,0.8)] animate-blink"></div>
                                    </div>
                                </div>
                            </div>

                            {/* Floating Rings */}
                            <div className="absolute -inset-4 border border-brand/30 rounded-full animate-spin-slow-reverse border-t-transparent border-l-transparent"></div>
                            <div className="absolute -inset-10 border border-brand/20 rounded-full animate-spin-slow border-r-transparent border-b-transparent"></div>
                        </div>
                    </div>

                    {/* Floating Conversation Bubbles (Parallax Layers) */}

                    {/* Bubble 1: Inquiry */}
                    <div
                        className={`absolute top-[20%] right-[10%] backdrop-blur-md bg-slate-800/80 border border-brand/30 p-4 rounded-2xl rounded-tr-none shadow-xl transition-all duration-500 ${typingStep >= 0 ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4'}`}
                        style={getParallaxStyle(0.04)}
                    >
                        <div className="flex items-center gap-3">
                            <div className="w-8 h-8 rounded-full bg-brand flex items-center justify-center">
                                <MessageCircle size={16} className="text-white" />
                            </div>
                            <div className="text-sm">
                                <div className="h-2 w-16 bg-white/20 rounded mb-2"></div>
                                <div className="h-2 w-24 bg-white/10 rounded"></div>
                            </div>
                        </div>
                        <div className="mt-2 text-xs text-brand-300 font-mono">
                            Detecting intent: <span className="text-white">Purchase Inquiry</span>
                        </div>
                    </div>

                    {/* Bubble 2: Processing */}
                    <div
                        className={`absolute bottom-[30%] left-[10%] backdrop-blur-md bg-slate-800/80 border border-brand/30 p-4 rounded-2xl rounded-tl-none shadow-xl transition-all duration-500 ${typingStep >= 1 ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4'}`}
                        style={getParallaxStyle(0.05)}
                    >
                        <div className="flex items-center gap-3">
                            <div className="w-8 h-8 rounded-full bg-brand flex items-center justify-center">
                                <Zap size={16} className="text-white" />
                            </div>
                            <p className="text-sm text-slate-200">جاري التحقق من المخزون...</p>
                        </div>
                    </div>

                    {/* Bubble 3: Sales Metric - Floating Widget */}
                    <div
                        className={`absolute top-[15%] left-[15%] backdrop-blur-md bg-green-900/40 border border-green-500/30 p-3 rounded-xl shadow-xl transition-all duration-500 delay-300 ${typingStep >= 2 ? 'opacity-100 scale-100' : 'opacity-0 scale-90'}`}
                        style={getParallaxStyle(0.03)}
                    >
                        <div className="flex items-center gap-2 mb-1">
                            <TrendingUp size={16} className="text-green-400" />
                            <span className="text-xs text-green-300">Conversion Rate</span>
                        </div>
                        <p className="text-lg font-bold text-white">+24.5%</p>
                    </div>

                    {/* Bubble 4: Success */}
                    <div
                        className={`absolute bottom-[20%] right-[15%] backdrop-blur-md bg-slate-800/80 border border-cyan-500/30 p-4 rounded-2xl rounded-br-none shadow-xl transition-all duration-500 delay-500 ${typingStep >= 1 ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4'}`}
                        style={getParallaxStyle(0.06)}
                    >
                        <div className="flex items-center gap-3">
                            <div className="w-8 h-8 rounded-full bg-cyan-500 flex items-center justify-center">
                                <CheckCircle size={16} className="text-white" />
                            </div>
                            <div>
                                <p className="text-white text-sm font-medium">تم إتمام الطلب</p>
                                <p className="text-xs text-slate-400">Order #4492</p>
                            </div>
                        </div>
                    </div>

                </div>
            </div>

            {/* Back Glow - Ambient Light behind the dashboard */}
            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[110%] h-[110%] bg-gradient-to-r from-brand/20 via-brand/20 to-pink-500/20 blur-[80px] -z-10 rounded-full"></div>
        </div>
    );
};

export default HeroDashboard;
