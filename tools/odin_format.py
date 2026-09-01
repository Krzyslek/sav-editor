import struct, sys, json
from collections import Counter, defaultdict

NAMED={1,3,9,11,13,15,17,19,21,23,25,27,29,31,33,35,37,39,41,43,45,50}
class R:
    def __init__(s,d): s.d=d; s.p=0
    def u8(s):  v=s.d[s.p]; s.p+=1; return v
    def i32(s): v=struct.unpack_from('<i',s.d,s.p)[0]; s.p+=4; return v
    def i64(s): v=struct.unpack_from('<q',s.d,s.p)[0]; s.p+=8; return v
    def st(s):
        f=s.u8(); n=s.i32()
        if f==0: v=s.d[s.p:s.p+n].decode('ascii','replace'); s.p+=n
        else:    v=s.d[s.p:s.p+n*2].decode('utf-16-le','surrogatepass'); s.p+=n*2
        return {'v':v,'f':f}
class W:
    def __init__(s): s.b=bytearray()
    def u8(s,v): s.b.append(v)
    def i32(s,v): s.b+=struct.pack('<i',v)
    def i64(s,v): s.b+=struct.pack('<q',v)
    def st(s,o):
        v=o['v']; s.u8(o['f']); s.i32(len(v))
        s.b += v.encode('ascii','replace') if o['f']==0 else v.encode('utf-16-le','surrogatepass')

def parse(d):
    r=R(d); types={}; root=[]; stack=[root]
    while r.p<len(d):
        m=r.u8(); n={'m':m}
        if m in NAMED: n['n']=r.st()
        if m in (1,2,3,4):
            t=r.u8()
            if t==47: tid=r.i32(); ts=r.st(); types[tid]=ts['v']; n['t']={'k':'name','id':tid,'s':ts}
            elif t==48: tid=r.i32(); n['t']={'k':'id','id':tid,'s':{'v':types.get(tid,''),'f':1}}
            elif t==46: n['t']={'k':'null'}
            else: raise Exception('bad type marker %d @%x'%(t,r.p-1))
            if m in (1,2): n['id']=r.i32()
            n['c']=[]
        elif m==6: n['len']=r.i64(); n['c']=[]
        elif m==8:
            cnt=r.i32(); esz=r.i32(); n['cnt']=cnt; n['esz']=esz; n['raw']=d[r.p:r.p+cnt*esz]; r.p+=cnt*esz
        elif m in (9,10,11,12,23,24): n['v']=r.i32()
        elif m in (15,16): n['v']=struct.unpack_from('<b',d,r.p)[0]; r.p+=1
        elif m in (17,18): n['v']=r.u8()
        elif m in (19,20): n['v']=struct.unpack_from('<h',d,r.p)[0]; r.p+=2
        elif m in (21,22): n['v']=struct.unpack_from('<H',d,r.p)[0]; r.p+=2
        elif m in (25,26): n['v']=struct.unpack_from('<I',d,r.p)[0]; r.p+=4
        elif m in (27,28): n['v']=r.i64()
        elif m in (29,30): n['v']=struct.unpack_from('<Q',d,r.p)[0]; r.p+=8
        elif m in (31,32): n['v']=struct.unpack_from('<f',d,r.p)[0]; n['raw4']=d[r.p:r.p+4]; r.p+=4
        elif m in (33,34): n['v']=struct.unpack_from('<d',d,r.p)[0]; n['raw8']=d[r.p:r.p+8]; r.p+=8
        elif m in (35,36,13,14,41,42): n['v']=d[r.p:r.p+16]; r.p+=16
        elif m in (37,38): n['v']=d[r.p:r.p+2]; r.p+=2
        elif m in (39,40,50,51): n['v']=r.st()
        elif m in (43,44): n['v']=r.u8()
        elif m in (45,46,5,7,49): pass
        elif m==47: tid=r.i32(); ts=r.st(); types[tid]=ts['v']; n['v']=(tid,ts)
        elif m==48: n['v']=r.i32()
        else: raise Exception('bad marker %d @%x'%(m,r.p-1))
        if m in (5,7):
            stack.pop(); stack[-1].append(n); continue
        stack[-1].append(n)
        if 'c' in n: stack.append(n['c'])
    return root,types

def write(nodes,w=None,tmap=None):
    top = w is None
    if top: w=W(); tmap={}
    for n in nodes:
        m=n['m']; w.u8(m)
        if 'n' in n: w.st(n['n'])
        if m in (1,2,3,4):
            t=n['t']
            if t['k']=='null': w.u8(46)
            else:
                nm=t['s']['v']
                if nm in tmap: w.u8(48); w.i32(tmap[nm])
                else:
                    tid=len(tmap); tmap[nm]=tid; w.u8(47); w.i32(tid); w.st(t['s'])
            if m in (1,2): w.i32(n['id'])
        elif m==6: w.i64(n['len'])
        elif m==8: w.i32(n['cnt']); w.i32(n['esz']); w.b+=n['raw']
        elif m in (9,10,11,12,23,24): w.i32(n['v'])
        elif m in (15,16): w.b+=struct.pack('<b',n['v'])
        elif m in (17,18): w.u8(n['v'])
        elif m in (19,20): w.b+=struct.pack('<h',n['v'])
        elif m in (21,22): w.b+=struct.pack('<H',n['v'])
        elif m in (25,26): w.b+=struct.pack('<I',n['v'])
        elif m in (27,28): w.i64(n['v'])
        elif m in (29,30): w.b+=struct.pack('<Q',n['v'])
        elif m in (31,32): w.b+=n['raw4']
        elif m in (33,34): w.b+=n['raw8']
        elif m in (35,36,13,14,41,42,37,38): w.b+=n['v']
        elif m in (39,40,50,51): w.st(n['v'])
        elif m in (43,44): w.u8(n['v'])
        elif m==47: w.i32(n['v'][0]); w.st(n['v'][1])
        elif m==48: w.i32(n['v'])
        if 'c' in n: write(n['c'],w,tmap)
    return bytes(w.b) if top else None

def iter_nodes(nodes):
    for n in nodes:
        yield n
        if 'c' in n:
            for x in iter_nodes(n['c']):
                yield x


def load(path):
    """Parse a .sav file -> (nodes, type table, raw bytes)."""
    data = open(path, 'rb').read()
    nodes, types = parse(data)
    return nodes, types, data


def roundtrip_ok(path):
    nodes, types, data = load(path)
    return write(nodes) == data


if __name__ == '__main__':
    nodes, types, data = load(sys.argv[1])
    out = write(nodes)
    print('file      :', sys.argv[1])
    print('size      :', len(data), 'bytes')
    print('entries   :', sum(1 for _ in iter_nodes(nodes)))
    print('types     :', len(types))
    print('round-trip:', 'IDENTICAL' if out == data else 'DIFFERS')
    if out != data:
        for i in range(min(len(out), len(data))):
            if out[i] != data[i]:
                print('first diff at 0x%x' % i)
                break
        raise SystemExit(1)


