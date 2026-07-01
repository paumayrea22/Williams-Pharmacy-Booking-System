import { useState, useEffect } from 'react';
import { supabase } from './lib/supabase';
import { DateTime } from 'luxon';
import { getErrorMessage } from './lib/errors';

interface TestResult {
    threadId: number;
    status: 'pending' | 'success' | 'failed';
    message: string;
}

interface Professional {
    id: number;
    default_duration_minutes: number;
}

export default function StressTest() {
    const [testResults, setTestResults] = useState<TestResult[]>([]);
    const [isTesting, setIsTesting] = useState(false);
    const [targetProfessional, setTargetProfessional] = useState<Professional | null>(null);

    useEffect(() => {
        const fetchTarget = async () => {
            try {
                const { data, error } = await supabase
                    .from('professionals')
                    .select('id, default_duration_minutes')
                    .limit(1)
                    .single();

                if (error) {
                    throw new Error(error.message);
                }
                
                setTargetProfessional(data);
            } catch (error) {
                console.error('Failed to load target professional:', getErrorMessage(error));
            }
        };
        
        fetchTarget();
    }, []);

    const executeConcurrencyAttack = async () => {
        if (!targetProfessional) return;

        setIsTesting(true);
        setTestResults([]);

        // Calculate a strict invariant time: Tomorrow at 09:00 AM Malta Time
        const tomorrow = DateTime.local({ zone: 'Europe/Malta' }).plus({ days: 1 }).set({ hour: 9, minute: 0, second: 0, millisecond: 0 });
        const startUtc = tomorrow.toUTC().toISO();
        const endUtc = tomorrow.plus({ minutes: targetProfessional.default_duration_minutes }).toUTC().toISO();

        if (!startUtc || !endUtc) {
            setIsTesting(false);
            return;
        }

        // Initialize UI states for the 3 parallel threads
        const initialResults: TestResult[] = [
            { threadId: 1, status: 'pending', message: 'Firing RPC...' },
            { threadId: 2, status: 'pending', message: 'Firing RPC...' },
            { threadId: 3, status: 'pending', message: 'Firing RPC...' }
        ];
        setTestResults(initialResults);

        // Build the identical payloads simulating 3 users hitting confirm at the exact same millisecond
        const rpcPayload = {
            p_professional_id: targetProfessional.id,
            p_room_number: 1,
            p_client_name: 'Stress Test Phantom',
            p_client_phone: '00000000',
            p_start_time_utc: startUtc,
            p_end_time_utc: endUtc,
            p_staff_username: 'System_Test'
        };

        const createPromise = async (threadId: number) => {
            const { error } = await supabase.rpc('book_appointment_secure', rpcPayload);
            if (error) {
                throw new Error(`Thread ${threadId} Rejected: ${error.message}`);
            }
            return `Thread ${threadId} Success: Appointment inserted safely.`;
        };

        try {
            // Fire all promises simultaneously. allSettled waits for all to finish regardless of individual rejections
            const results = await Promise.allSettled([
                createPromise(1),
                createPromise(2),
                createPromise(3)
            ]);

            const finalResults: TestResult[] = results.map((result, index) => {
                if (result.status === 'fulfilled') {
                    return { threadId: index + 1, status: 'success', message: result.value };
                } else {
                    return { threadId: index + 1, status: 'failed', message: getErrorMessage(result.reason) };
                }
            });

            setTestResults(finalResults);

        } catch (error) {
            console.error('Catastrophic failure in test harness:', getErrorMessage(error));
        } finally {
            setIsTesting(false);
        }
    };

    return (
        <div className="p-8 max-w-3xl mx-auto flex flex-col gap-6">
            <div className="border-b border-gray-200 pb-4">
                <h1 className="text-2xl font-black text-gray-800">Concurrency Stress Test</h1>
                <p className="text-sm text-gray-500 mt-1">
                    Validates the PL/pgSQL pessimistic locking (SELECT FOR UPDATE) preventing double-booking room collisions.
                </p>
            </div>

            <div className="bg-slate-50 p-6 rounded-xl border border-slate-200 shadow-sm flex flex-col gap-4">
                <p className="text-sm text-slate-700 font-medium">
                    This test will attempt to fire 3 identical appointment insertions at the exact same millisecond. 
                    If the database architecture is solid, only 1 thread will succeed, and 2 will be blocked by the RPC exception raiser.
                </p>

                <button
                    onClick={executeConcurrencyAttack}
                    disabled={isTesting || !targetProfessional}
                    className="w-full sm:w-auto self-start bg-red-600 hover:bg-red-700 text-white font-bold py-3 px-6 rounded-lg shadow-md transition-all disabled:opacity-50"
                >
                    {isTesting ? 'Attacking Database...' : 'Launch Simultaneous Attack'}
                </button>
            </div>

            {testResults.length > 0 && (
                <div className="flex flex-col gap-3 mt-4">
                    <h3 className="font-bold text-gray-800 text-lg">Transaction Results:</h3>
                    {testResults.map((res) => (
                        <div 
                            key={res.threadId} 
                            className={`p-4 rounded-lg border font-mono text-sm shadow-sm ${
                                res.status === 'success' ? 'bg-green-50 border-green-200 text-green-800' : 
                                res.status === 'failed' ? 'bg-red-50 border-red-200 text-red-800' : 
                                'bg-gray-50 border-gray-200 text-gray-500 animate-pulse'
                            }`}
                        >
                            <span className="font-bold mr-2">[THREAD 0{res.threadId}]</span>
                            {res.message}
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}