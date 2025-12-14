export interface User {
  id: string;
  email: string;
  password: string;
  name: string;
  subscription?: 'free' | 'pro' | 'enterprise';
  subscriptionEnd?: Date;
  apiUsage: number;
  lastResetDate: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface LoginRequest {
  email: string;
  password: string;
}

export interface RegisterRequest {
  email: string;
  password: string;
  name: string;
}

export interface AuthResponse {
  user: Omit<User, 'password'>;
  token: string;
  expiresIn: number;
}

export interface JwtPayload {
  userId: string;
  email: string;
  subscription: string;
}