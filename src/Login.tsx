import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from './lib/supabase';

export default function Login() {
    const [isRegistering, setIsRegistering] = useState(false);
    const [isRecovering, setIsRecovering] = useState(false);
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [username, setUsername] = useState('');
    
    const [errorMessage, setErrorMessage] = useState('');
    const [successMessage, setSuccessMessage] = useState('');
    const [isProcessing, setIsProcessing] = useState(false);
    const [showPassword, setShowPassword] = useState(false);
    const [showConfirmPassword, setShowConfirmPassword] = useState(false);
    
    const navigate = useNavigate();

    useEffect(() => {
        const checkRecoveryState = async () => {
            const hash = window.location.hash;
            if (hash && hash.includes('type=recovery')) {
                setIsRecovering(true);
                setSuccessMessage('Authentication successful. Please enter your new password.');
            }
        };

        checkRecoveryState();

        // Removed unused 'session' variable to prevent TypeScript strict mode build failures in Vercel
        const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
            if (event === 'PASSWORD_RECOVERY') {
                setIsRecovering(true);
                setSuccessMessage('Authentication successful. Please enter your new password.');
            }
        });

        return () => subscription.unsubscribe();
    }, []);

    const handleFormSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setErrorMessage('');
        setSuccessMessage('');
        setIsProcessing(true);

        try {
            if (isRecovering) {
                if (password !== confirmPassword) {
                    throw new Error('Validation Error: Passwords do not match. Please try again.');
                }
                if (password.length < 8) {
                    throw new Error('Validation Error: Password must be at least 8 characters long.');
                }

                const { error: updateError } = await supabase.auth.updateUser({ password: password });
                if (updateError) throw updateError;
                
                setSuccessMessage('Password successfully updated! Redirecting to dashboard...');
                
                window.history.replaceState(null, '', window.location.pathname);
                
                setTimeout(() => {
                    navigate('/');
                }, 2000);
                return;
            }

            if (isRegistering) {
                if (password !== confirmPassword) {
                    throw new Error('Validation Error: Passwords do not match. Please try again.');
                }

                const prefixRegex = /^(D-|P-).+$/;
                if (!prefixRegex.test(username)) {
                    throw new Error('Validation Error: Username must strictly start with "D-" (Doctor) or "P-" (Pharmacy). Ex: P-Denisse');
                }

                const { error: authError } = await supabase.auth.signUp({
                    email: email,
                    password: password,
                    options: {
                        data: { username: username }
                    }
                });

                if (authError) throw authError;
                navigate('/');
                return;
            } 
            
            const { error: authError } = await supabase.auth.signInWithPassword({
                email: email,
                password: password
            });

            if (authError) {
                throw new Error('Invalid credentials. Please verify your email and password.');
            }
            navigate('/');
            
        } catch (error: any) {
            const extractedMessage = error?.message || error?.error_description || error?.msg || 'An unexpected error occurred.';
            setErrorMessage(extractedMessage);
        } finally {
            setIsProcessing(false);
        }
    };

    const handlePasswordReset = async () => {
        setErrorMessage('');
        setSuccessMessage('');
        
        if (!email) {
            setErrorMessage('Please enter your email address first to receive a reset link.');
            return;
        }

        setIsProcessing(true);
        try {
            const { error } = await supabase.auth.resetPasswordForEmail(email, {
                redirectTo: `${window.location.origin}/login`, 
            });

            if (error) throw error;
            setSuccessMessage('A secure password reset link has been sent to your email.');
        } catch (error: any) {
            setErrorMessage(error?.message || 'Failed to send password reset link. Please try again later.');
        } finally {
            setIsProcessing(false);
        }
    };

    const toggleMode = () => {
        setIsRegistering(!isRegistering);
        setErrorMessage('');
        setSuccessMessage('');
        setPassword('');
        setConfirmPassword('');
    };

    return (
        <div className="flex min-h-screen items-center justify-center bg-pharmacy-cream p-4">
            <div className="w-full max-w-md rounded-xl bg-white p-6 sm:p-8 shadow-lg border border-pharmacy-ink/10">
                <h2 className="mb-6 text-center font-display text-2xl text-pharmacy-ink">
                    {isRecovering ? 'Update Password' : (isRegistering ? 'Staff Registration' : 'Internal Access')}
                </h2>

                {errorMessage && (
                    <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm font-medium text-red-700 shadow-sm">
                        {errorMessage}
                    </div>
                )}

                {successMessage && (
                    <div className="mb-4 rounded-lg border border-green-200 bg-green-50 p-3 text-sm font-medium text-green-700 shadow-sm">
                        {successMessage}
                    </div>
                )}

                <form onSubmit={handleFormSubmit} className="space-y-4">
                    {!isRecovering && isRegistering && (
                        <div>
                            <label className="block text-sm font-medium text-pharmacy-ink">Username</label>
                            <input
                                type="text"
                                value={username}
                                onChange={(e) => setUsername(e.target.value)}
                                placeholder="Ex: P-Denisse or D-Fsadni"
                                className="mt-1 w-full rounded-md border border-pharmacy-ink/20 p-3 shadow-sm focus:border-pharmacy-gold focus:outline-none focus:ring-1 focus:ring-pharmacy-gold"
                                required={isRegistering}
                                disabled={isProcessing}
                            />
                        </div>
                    )}

                    {!isRecovering && (
                        <div>
                            <label className="block text-sm font-medium text-pharmacy-ink">Email Address</label>
                            <input
                                type="email"
                                value={email}
                                onChange={(e) => setEmail(e.target.value)}
                                placeholder="email@pharmacy.com"
                                className="mt-1 w-full rounded-md border border-pharmacy-ink/20 p-3 shadow-sm focus:border-pharmacy-gold focus:outline-none focus:ring-1 focus:ring-pharmacy-gold"
                                required={!isRecovering}
                                disabled={isProcessing}
                            />
                        </div>
                    )}

                    <div>
                        <div className="flex justify-between items-center">
                            <label className="block text-sm font-medium text-pharmacy-ink">
                                {isRecovering ? 'New Password' : 'Password'}
                            </label>
                            {!isRegistering && !isRecovering && (
                                <button
                                    type="button"
                                    onClick={handlePasswordReset}
                                    disabled={isProcessing}
                                    className="text-xs font-medium text-pharmacy-gold hover:text-pharmacy-gold-dark hover:underline disabled:text-gray-400"
                                >
                                    Forgot your password?
                                </button>
                            )}
                        </div>
                        <div className="relative mt-1">
                            <input
                                type={showPassword ? 'text' : 'password'}
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                                placeholder="Minimum 8 characters"
                                minLength={8}
                                className="w-full rounded-md border border-pharmacy-ink/20 p-3 pr-11 shadow-sm focus:border-pharmacy-gold focus:outline-none focus:ring-1 focus:ring-pharmacy-gold"
                                required
                                disabled={isProcessing}
                            />
                            <button
                                type="button"
                                onClick={() => setShowPassword(!showPassword)}
                                disabled={isProcessing}
                                className="absolute inset-y-0 right-0 flex items-center px-3 text-pharmacy-ink/50 hover:text-pharmacy-ink disabled:text-gray-300"
                                aria-label={showPassword ? 'Hide password' : 'Show password'}
                                tabIndex={-1}
                            >
                                {showPassword ? (
                                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} className="h-5 w-5">
                                        <path strokeLinecap="round" strokeLinejoin="round" d="M3.98 8.223A10.477 10.477 0 001.5 12c1.847 4.31 6.014 7.5 10.5 7.5 1.657 0 3.226-.404 4.591-1.118M6.228 6.228A10.45 10.45 0 0112 4.5c4.486 0 8.653 3.19 10.5 7.5a10.523 10.523 0 01-4.293 5.774M6.228 6.228L3 3m3.228 3.228l3.65 3.65m7.894 7.894L21 21m-3.228-3.228l-3.65-3.65m0 0a3 3 0 10-4.243-4.243m4.242 4.242L9.88 9.88" />
                                    </svg>
                                ) : (
                                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} className="h-5 w-5">
                                        <path strokeLinecap="round" strokeLinejoin="round" d="M2.036 12.322a1.012 1.012 0 010-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178z" />
                                        <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                                    </svg>
                                )}
                            </button>
                        </div>
                    </div>

                    {(isRegistering || isRecovering) && (
                        <div>
                            <label className="block text-sm font-medium text-pharmacy-ink">Confirm Password</label>
                            <div className="relative mt-1">
                                <input
                                    type={showConfirmPassword ? 'text' : 'password'}
                                    value={confirmPassword}
                                    onChange={(e) => setConfirmPassword(e.target.value)}
                                    placeholder="Re-enter password"
                                    minLength={8}
                                    className="w-full rounded-md border border-pharmacy-ink/20 p-3 pr-11 shadow-sm focus:border-pharmacy-gold focus:outline-none focus:ring-1 focus:ring-pharmacy-gold"
                                    required={isRegistering || isRecovering}
                                    disabled={isProcessing}
                                />
                                <button
                                    type="button"
                                    onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                                    disabled={isProcessing}
                                    className="absolute inset-y-0 right-0 flex items-center px-3 text-pharmacy-ink/50 hover:text-pharmacy-ink disabled:text-gray-300"
                                    aria-label={showConfirmPassword ? 'Hide password' : 'Show password'}
                                    tabIndex={-1}
                                >
                                    {showConfirmPassword ? (
                                        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} className="h-5 w-5">
                                            <path strokeLinecap="round" strokeLinejoin="round" d="M3.98 8.223A10.477 10.477 0 001.5 12c1.847 4.31 6.014 7.5 10.5 7.5 1.657 0 3.226-.404 4.591-1.118M6.228 6.228A10.45 10.45 0 0112 4.5c4.486 0 8.653 3.19 10.5 7.5a10.523 10.523 0 01-4.293 5.774M6.228 6.228L3 3m3.228 3.228l3.65 3.65m7.894 7.894L21 21m-3.228-3.228l-3.65-3.65m0 0a3 3 0 10-4.243-4.243m4.242 4.242L9.88 9.88" />
                                        </svg>
                                    ) : (
                                        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} className="h-5 w-5">
                                            <path strokeLinecap="round" strokeLinejoin="round" d="M2.036 12.322a1.012 1.012 0 010-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178z" />
                                            <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                                        </svg>
                                    )}
                                </button>
                            </div>
                        </div>
                    )}

                    <button
                        type="submit"
                        disabled={isProcessing}
                        className={`w-full rounded-md p-3 font-semibold transition shadow-md mt-4 ${
                            isProcessing ? 'bg-gray-300 text-white cursor-not-allowed' : 'bg-pharmacy-gold text-pharmacy-green hover:bg-pharmacy-gold-dark hover:text-white'
                        }`}
                    >
                        {isProcessing ? 'Processing...' : (isRecovering ? 'Save New Password' : (isRegistering ? 'Create Secure Account' : 'Enter System'))}
                    </button>
                </form>

                {!isRecovering && (
                    <div className="mt-6 text-center">
                        <button
                            type="button"
                            onClick={toggleMode}
                            disabled={isProcessing}
                            className="text-sm text-pharmacy-gold-dark hover:underline disabled:text-gray-400 font-medium"
                        >
                            {isRegistering ? 'Already have an account? Sign in' : 'First time? Create your password'}
                        </button>
                    </div>
                )}
            </div>
        </div>
    );
}