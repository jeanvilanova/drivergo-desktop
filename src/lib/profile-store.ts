import { app } from 'electron';
import fs from 'node:fs';
import path from 'node:path';

export interface ProfileUser {
  id: string;
  username: string;
  display_name: string;
  minio_bucket_name: string;
}

let activeProfilePath: string | null = null;

/**
 * Retorna o path completo de um arquivo de config dentro do perfil ativo.
 * Se nenhum perfil estiver ativo, cai no diretório userData raiz (retrocompat).
 */
export function getProfileConfigPath(filename: string): string {
  if (activeProfilePath) {
    return path.join(activeProfilePath, filename);
  }
  return path.join(app.getPath('userData'), filename);
}

/**
 * Ativa o perfil do usuário: cria o diretório de perfil se necessário,
 * grava o arquivo profile.json e define o caminho ativo.
 */
export async function activateProfile(user: ProfileUser): Promise<void> {
  const profileDir = path.join(app.getPath('userData'), 'profiles', user.id);
  await fs.promises.mkdir(profileDir, { recursive: true });
  await fs.promises.writeFile(
    path.join(profileDir, 'profile.json'),
    JSON.stringify({
      id: user.id,
      username: user.username,
      display_name: user.display_name,
      loginAt: new Date().toISOString(),
    }, null, 2),
    'utf-8',
  );
  activeProfilePath = profileDir;
}

/**
 * Desativa o perfil — chamado no logout para garantir que o próximo
 * usuário não carregue as configurações do anterior.
 */
export function deactivateProfile(): void {
  activeProfilePath = null;
}
