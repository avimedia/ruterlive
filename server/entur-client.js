/**
 * ET-Client-Name for alle kall mot Entur. Kan overstyres med ENTUR_CLIENT_NAME lokalt,
 * så testing og memcheck ikke bruker opp rate-limit-kvoten til produksjon.
 */
export const CLIENT_NAME = process.env.ENTUR_CLIENT_NAME || 'ruterlive-web';
