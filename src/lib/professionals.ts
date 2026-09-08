// "Dr. Admin" is a professional record reserved for the Administrator account's own testing/admin
// bookings. It must stay invisible in every doctor-selection dropdown for anyone else.
const ADMIN_ONLY_USERNAME = 'P-Administrator';

export const isAdminOnlyProfessional = (fullName: string): boolean =>
    fullName.toLowerCase().includes('admin');

export const filterSelectableProfessionals = <T extends { full_name: string }>(
    professionals: T[],
    username: string | null | undefined
): T[] => {
    if (username === ADMIN_ONLY_USERNAME) return professionals;
    return professionals.filter(p => !isAdminOnlyProfessional(p.full_name));
};
