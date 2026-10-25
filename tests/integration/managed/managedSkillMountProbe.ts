import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';

/** Give a disposable native workspace a Junction whose target prints correctly but cannot be opened. */
export function makeUnavailableSkillMount(workspace: string): string | undefined {
  if (process.platform !== 'win32') return undefined;
  const directory = path.join(workspace, '.claude', 'skills');
  const name = readdirSync(directory).find((name) => name.startsWith('officecli-docx-nw-'));
  if (!name) throw new Error('No published Office skill mount to probe');
  const mounted = path.join(directory, name);
  const python = process.env.NEXWORK_TEST_PYTHON;
  if (!python) throw new Error('NEXWORK_TEST_PYTHON is required for the native Windows mount probe');
  const script = String.raw`
import ctypes, os, struct, sys
p=sys.argv[1]
target=os.readlink(p)
if target.startswith('\\\\?\\'):
    target=target[4:]
# NT reparse targets do not apply DOS dot-segment normalization. The printed
# target is valid, reproducing "lstat/readlink succeed but SKILL.md is ENOENT".
sub=('\\??\\'+target+'\\.').encode('utf-16-le')
printed=target.encode('utf-16-le')
paths=sub+b'\0\0'+printed+b'\0\0'
data=struct.pack('<IHHHHHH',0xa0000003,8+len(paths),0,0,len(sub),len(sub)+2,len(printed))+paths
k=ctypes.WinDLL('kernel32',use_last_error=True)
k.CreateFileW.argtypes=[ctypes.c_wchar_p,ctypes.c_uint32,ctypes.c_uint32,ctypes.c_void_p,ctypes.c_uint32,ctypes.c_uint32,ctypes.c_void_p]
k.CreateFileW.restype=ctypes.c_void_p
k.DeviceIoControl.argtypes=[ctypes.c_void_p,ctypes.c_uint32,ctypes.c_void_p,ctypes.c_uint32,ctypes.c_void_p,ctypes.c_uint32,ctypes.POINTER(ctypes.c_uint32),ctypes.c_void_p]
k.CloseHandle.argtypes=[ctypes.c_void_p]
h=k.CreateFileW(p,0x40000000,7,None,3,0x00200000|0x02000000,None)
buf=ctypes.create_string_buffer(data); count=ctypes.c_uint32()
if not k.DeviceIoControl(h,0x900a4,buf,len(data),None,0,ctypes.byref(count),None):
    raise ctypes.WinError(ctypes.get_last_error())
k.CloseHandle(h)
`;
  const result = spawnSync(python, ['-c', script, mounted], { encoding: 'utf8', timeout: 10_000 });
  if (result.status !== 0) throw new Error('Could not prepare Windows mount fault: ' + result.stderr);
  if (existsSync(path.join(mounted, 'SKILL.md'))) throw new Error('The Windows mount fault was not reproduced');
  return mounted;
}
