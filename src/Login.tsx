import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from './lib/supabase';
import { getErrorMessage } from './lib/errors';

export default function Login() {
    const [isRegistering, setIsRegistering] = useState(false);
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [username, setUsername] = useState('');
    const [errorMessage, setErrorMessage] = useState('');
    const [isProcessing, setIsProcessing] = useState(false);
    
    const navigate = useNavigate();

    const handleFormSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setErrorMessage('');
        setIsProcessing(true);

        try {
            if (isRegistering) {
                // Strict prefix validation using RegEx for Doctors and Pharmacists
                const prefixRegex = /^(D-|P-).+$/;
                
                if (!prefixRegex.test(username)) {
                    throw new Error('Error: Username must strictly start with "D-" (Doctor) or "P-" (Pharmacy). Ex: P-Denisse');
                }

                // Register in Supabase injecting the username. The SQL Trigger will assign the immutable role.
                const { error: authError } = await supabase.auth.signUp({
                    email: email,
                    password: password,
                    options: {
                        data: {
                            username: username
                        }
                    }
                });

                if (authError) {
                    throw new Error(authError.message);
                }
                
                navigate('/');
            } else {
                // Standard login flow
                const { error: authError } = await supabase.auth.signInWithPassword({
                    email: email,
                    password: password
                });

                if (authError) {
                    throw new Error('Invalid credentials. Please verify your email and password.');
                }
                
                navigate('/');
            }
        } catch (error) {
            // Catch generic exceptions and errors delegated by Supabase using the strict error handler
            setErrorMessage(getErrorMessage(error, 'An unexpected network error occurred.'));
        } finally {
            // Guaranteed UI unlock regardless of the result
            setIsProcessing(false);
        }
    };

    return (
        <div className="flex min-h-screen items-center justify-center bg-gray-100 p-4">
            <div className="w-full max-w-md rounded-xl bg-white p-8 shadow-lg">
                <h2 className="mb-6 text-center text-2xl font-bold text-gray-800">
                    {isRegistering ? 'Staff Registration' : 'Internal Access'}
                </h2>

                {errorMessage && (
                    <div className="mb-4 rounded-lg border border-red-200 bg-red-100 p-3 text-sm text-red-700">
                        {errorMessage}
                    </div>
                )}

                <form onSubmit={handleFormSubmit} className="space-y-4">
                    {isRegistering && (
                        <div>
                            <label className="block text-sm font-medium text-gray-700">Username</label>
                            <input
                                type="text"
                                value={username}
                                onChange={(e) => setUsername(e.target.value)}
                                placeholder="Ex: P-Denisse or D-Fsadni"
                                className="mt-1 w-full rounded-md border border-gray-300 p-3 shadow-sm focus:border-blue-500 focus:outline-none"
                                required={isRegistering}
                                disabled={isProcessing}
                            />
                        </div>
                    )}

                    <div>
                        <label className="block text-sm font-medium text-gray-700">Email Address</label>
                        <input
                            type="email"
                            value={email}
                            onChange={(e) => setEmail(e.target.value)}
                            placeholder="email@pharmacy.com"
                            className="mt-1 w-full rounded-md border border-gray-300 p-3 shadow-sm focus:border-blue-500 focus:outline-none"
                            required
                            disabled={isProcessing}
                        />
                    </div>

                    <div>
                        <label className="block text-sm font-medium text-gray-700">Password</label>
                        <input
                            type="password"
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            placeholder="Minimum 8 characters"
                            minLength={8}
                            className="mt-1 w-full rounded-md border border-gray-300 p-3 shadow-sm focus:border-blue-500 focus:outline-none"
                            required
                            disabled={isProcessing}
                        />
                    </div>

                    <button
                        type="submit"
                        disabled={isProcessing}
                        className={`w-full rounded-md p-3 font-semibold text-white transition ${
                            isProcessing ? 'bg-gray-400 cursor-not-allowed' : 'bg-blue-600 hover:bg-blue-700'
                        }`}
                    >
                        {isProcessing ? 'Processing...' : (isRegistering ? 'Create Secure Account' : 'Enter System')}
                    </button>
                </form>

                <div className="mt-6 text-center">
                    <button
                        onClick={() => {
                            setIsRegistering(!isRegistering);
                            setErrorMessage('');
                        }}
                        disabled={isProcessing}
                        className="text-sm text-blue-600 hover:underline disabled:text-gray-400"
                    >
                        {isRegistering ? 'Already have an account? Sign in' : 'First time? Create your password'}
                    </button>
                </div>
            </div>
        </div>
    );
}