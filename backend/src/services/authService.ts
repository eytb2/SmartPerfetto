import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { User, LoginRequest, RegisterRequest, AuthResponse, JwtPayload } from '../types/auth';

// 模拟数据库存储（实际项目中应该使用真实数据库）
let users: User[] = [];
const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-in-production';
const JWT_EXPIRES_IN = '7d';

class AuthService {
  async register(data: RegisterRequest): Promise<AuthResponse> {
    // 检查邮箱是否已存在
    const existingUser = users.find(u => u.email === data.email);
    if (existingUser) {
      throw new Error('Email already registered');
    }

    // 加密密码
    const hashedPassword = await bcrypt.hash(data.password, 10);

    // 创建新用户
    const newUser: User = {
      id: this.generateId(),
      email: data.email,
      password: hashedPassword,
      name: data.name,
      subscription: 'free',
      apiUsage: 0,
      lastResetDate: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    users.push(newUser);

    // 生成 JWT
    const token = this.generateToken(newUser);

    // 返回用户信息（不包含密码）
    const { password, ...userWithoutPassword } = newUser;

    return {
      user: userWithoutPassword,
      token,
      expiresIn: 7 * 24 * 60 * 60, // 7 days in seconds
    };
  }

  async login(data: LoginRequest): Promise<AuthResponse> {
    // 查找用户
    const user = users.find(u => u.email === data.email);
    if (!user) {
      throw new Error('Invalid email or password');
    }

    // 验证密码
    const isValidPassword = await bcrypt.compare(data.password, user.password);
    if (!isValidPassword) {
      throw new Error('Invalid email or password');
    }

    // 生成 JWT
    const token = this.generateToken(user);

    // 返回用户信息（不包含密码）
    const { password, ...userWithoutPassword } = user;

    return {
      user: userWithoutPassword,
      token,
      expiresIn: 7 * 24 * 60 * 60, // 7 days in seconds
    };
  }

  async verifyToken(token: string): Promise<JwtPayload> {
    try {
      const decoded = jwt.verify(token, JWT_SECRET) as JwtPayload;
      return decoded;
    } catch (error) {
      throw new Error('Invalid token');
    }
  }

  async getUserById(id: string): Promise<Omit<User, 'password'> | null> {
    const user = users.find(u => u.id === id);
    if (!user) return null;

    const { password, ...userWithoutPassword } = user;
    return userWithoutPassword;
  }

  async updateUserSubscription(userId: string, subscription: 'pro' | 'enterprise'): Promise<void> {
    const user = users.find(u => u.id === userId);
    if (!user) {
      throw new Error('User not found');
    }

    user.subscription = subscription;
    user.subscriptionEnd = new Date();
    user.subscriptionEnd.setMonth(user.subscriptionEnd.getMonth() + 1); // 1 month subscription
    user.updatedAt = new Date();
  }

  async checkAndUpdateUsage(userId: string, isTraceAnalysis: boolean = false): Promise<boolean> {
    const user = users.find(u => u.id === userId);
    if (!user) {
      throw new Error('User not found');
    }

    const now = new Date();
    const lastReset = new Date(user.lastResetDate);

    // 检查是否需要重置使用量（每月重置）
    if (now.getMonth() !== lastReset.getMonth() || now.getFullYear() !== lastReset.getFullYear()) {
      user.apiUsage = 0;
      user.lastResetDate = now;
    }

    // 检查使用限制
    if (user.subscription === 'free') {
      const limit = isTraceAnalysis ? 5 : 100; // 免费用户每月 5 次 trace 分析，100 次 SQL 生成
      if (user.apiUsage >= limit) {
        return false;
      }
    }

    // 增加使用量
    user.apiUsage += 1;
    user.updatedAt = now;

    return true;
  }

  private generateToken(user: User): string {
    const payload: JwtPayload = {
      userId: user.id,
      email: user.email,
      subscription: user.subscription || 'free',
    };

    return jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
  }

  private generateId(): string {
    return Math.random().toString(36).substr(2, 9);
  }
}

export default AuthService;