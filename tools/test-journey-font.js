'use strict';
// Read WOFF2's untransformed cmap directly; no fontTools/browser dependency.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),zlib=require('node:zlib');
const root=path.resolve(__dirname,'..');
const tags=['cmap','head','hhea','hmtx','maxp','name','OS/2','post','cvt ','fpgm','glyf','loca','prep','CFF ','VORG','EBDT','EBLC','gasp','hdmx','kern','LTSH','PCLT','VDMX','vhea','vmtx','BASE','GDEF','GPOS','GSUB','EBSC','JSTF','MATH','CBDT','CBLC','COLR','CPAL','SVG ','sbix','acnt','avar','bdat','bloc','bsln','cvar','fdsc','feat','fmtx','fvar','gvar','hsty','just','lcar','mort','morx','opbd','prop','trak','Zapf','Silf','Glat','Gloc','Feat','Sill'];
function readCmap(buffer){
  assert.equal(buffer.toString('ascii',0,4),'wOF2');
  let offset=48,total=0,cmapEntry;
  function base128(){let value=0;for(let i=0;i<5;i++){const b=buffer[offset++];assert.notEqual(b,undefined);value=value*128+(b&127);if(!(b&128))return value;}throw Error('Invalid WOFF2 length');}
  for(let i=0;i<buffer.readUInt16BE(12);i++){
    const flags=buffer[offset++],tagIndex=flags&63,version=flags>>6;
    const tag=tagIndex===63?buffer.toString('ascii',offset,offset+=4):tags[tagIndex];
    const original=base128(),transformed=['glyf','loca'].includes(tag)?version===0:version!==0;
    const length=transformed?base128():original;
    if(tag==='cmap'){assert(!transformed,'cmap must not be transformed');cmapEntry={offset:total,length};}
    total+=length;
  }
  const decoded=zlib.brotliDecompressSync(buffer.subarray(offset,offset+buffer.readUInt32BE(20)));
  assert.equal(decoded.length,total);assert(cmapEntry,'font cmap exists');
  return decoded.subarray(cmapEntry.offset,cmapEntry.offset+cmapEntry.length);
}
function hasGlyph(cmap,code){
  for(let i=0;i<cmap.readUInt16BE(2);i++){
    const record=4+i*8,platform=cmap.readUInt16BE(record),encoding=cmap.readUInt16BE(record+2);
    if(platform!==0&&!(platform===3&&[1,10].includes(encoding)))continue;
    const start=cmap.readUInt32BE(record+4),format=cmap.readUInt16BE(start);
    if(format===12){
      for(let j=0;j<cmap.readUInt32BE(start+12);j++){const p=start+16+j*12,lo=cmap.readUInt32BE(p),hi=cmap.readUInt32BE(p+4);if(code>=lo&&code<=hi&&cmap.readUInt32BE(p+8)+code-lo!==0)return true;}
    }else if(format===4&&code<=0xffff){
      const count=cmap.readUInt16BE(start+6)/2,ends=start+14,starts=ends+2*count+2,deltas=starts+2*count,ranges=deltas+2*count;
      for(let j=0;j<count;j++){
        const lo=cmap.readUInt16BE(starts+2*j),hi=cmap.readUInt16BE(ends+2*j);if(code<lo||code>hi)continue;
        const delta=cmap.readInt16BE(deltas+2*j),range=cmap.readUInt16BE(ranges+2*j);
        let glyph=range?cmap.readUInt16BE(ranges+2*j+range+2*(code-lo)):(code+delta)&65535;
        if(range&&glyph)glyph=(glyph+delta)&65535;
        if(glyph)return true;
      }
    }
  }
  return false;
}
const seed='一卷黄鹤楼主楼古铜顶白云阁鹅池读这一景出处与核对景物札记收卷留念回到画卷正在取阅';
const files=['explore-journey.html','tools/preview/exploration-trial-suite.html','tools/fixtures/four-scenes-study.json','tools/fixtures/four-scenes-inquiries.json',...fs.readdirSync(path.join(root,'static')).filter(name=>/^exploration-journey-.*\.js$/.test(name)).map(name=>'static/'+name)];
const required=new Set((seed+files.map(file=>fs.readFileSync(path.join(root,file),'utf8')).join('')).match(/[\u3400-\u9fff]/gu));
const buffer=fs.readFileSync(path.join(root,'static/assets/longcang-journey-v1.woff2')),cmap=readCmap(buffer);
assert(buffer.length<750000,'heading font remains bounded under 750KB');
const missing=[...required].filter(character=>!hasGlyph(cmap,character.codePointAt(0)));
assert.equal(missing.join(''),'','Regenerate journey font to cover newly added text: '+missing.join(''));
assert(fs.readFileSync(path.join(root,'static/assets/longcang-OFL.txt'),'utf8').includes('SIL OPEN FONT LICENSE'));
console.log('Journey font: '+required.size+' required CJK glyphs verified; '+buffer.length+' bytes; OFL license retained.');
