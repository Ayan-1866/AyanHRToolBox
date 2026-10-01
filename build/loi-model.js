/* ---------- LOI letter model: shared by loi.html and the Bulk Letters tool ---------- */
// run: {t, b, u, ar, k (field key), tab, br}   para: {runs, al, after (pt), before (pt), tr (right tab), bl (bullet), keep}
// LOI.build(get) takes get(key) -> display string ("" when missing) and returns the paragraphs.
const LOI=(function(){
  const LABEL={SC:"Short-company",SL:"Short-location",SLNO:"Sl. no.",DATE:"Date",NAME:"Name",ADDRESS:"Address",DESIG:"Position",DOJ:"Joining date",COMPANY:"Company",PLACE:"Place of work",PROB:"Probation",NOTICE:"Notice days",FY:"FY"};
  const B={b:1};
  function build(get){
    const F=(k,o)=>{const v=get(k)||"";return Object.assign({t:v||LABEL[k],k,empty:!v},o||{});};
    const lines=(k,o)=>{const v=get(k)||"";if(!v)return[F(k,o)];const r=[];v.split(/\r?\n/).map(s=>s.trim()).filter(Boolean).forEach((l,i)=>{if(i)r.push({br:1});r.push(Object.assign({t:l,k},o));});return r;};
    const prob=F("PROB",B);prob.t+=" months";
    const probPlain=F("PROB");probPlain.t+=" months";
    return [
      {tr:1,after:24,runs:[{t:"Ref no:- ",b:1},F("SC",B),{t:"/HR/",b:1},F("SL",B),{t:"/LOI/",b:1},F("FY",B),{t:"/",b:1},F("SLNO",B),{tab:1},{t:"Date:  ",b:1},F("DATE",B)]},
      {al:"center",after:14,runs:[{t:"Letter of Intent",b:1,u:1}]},
      {runs:[{t:"To,",b:1}]},
      {runs:[F("NAME",B)]},
      {after:12,runs:lines("ADDRESS",B)},
      {al:"both",after:12,runs:[{t:"With reference to your application and subsequent interview you had with us, we are pleased to offer you the position of "},{t:"“",b:1,ar:1},F("DESIG",{b:1,ar:1}),{t:"”",b:1,ar:1},{t:" in our organization on the following terms and conditions as mutually discussed and agreed upon. You are requested to join our organization as on or before "},F("DOJ",B),{t:". A detailed letter of appointment shall be issued to you on your joining our organization."}]},
      {runs:[{t:"Probation",b:1}]},
      {al:"both",after:12,runs:[{t:"You will be on probation for "},prob,{t:". Depending on your performance during the aforesaid period, the probation period is liable to be extended by another "},probPlain,{t:". In case you wish to resign during the said probation period, you shall be required to furnish a prior written notice of "},F("NOTICE"),{t:" days. At the end of the probation period, your services would be confirmed and you would be informed in writing of the same."}]},
      {runs:[{t:"Remuneration",b:1}]},
      {after:12,runs:[{t:"The details will be shared in the appointment letter."}]},
      {runs:[{t:"Place of Work",b:1}]},
      {al:"both",after:12,runs:[{t:"Your current location would be at "},F("PLACE",B),{t:/\.$/.test(get("PLACE")||"")?"":".",b:1},{t:" However, you may be transferred/ posted in any of the company branch offices or project locations in the country or abroad, at the discretion of the company."}]},
      {al:"both",after:12,runs:[{t:"At the time of joining you are requested to submit the following documents for verification & record:"}]},
      {bl:1,runs:[{t:"Educational certificates and testimonials"}]},
      {bl:1,runs:[{t:"Copy of PAN card and passport-size photographs"}]},
      {bl:1,runs:[{t:"Address proof"}]},
      {bl:1,after:12,runs:[{t:"Copies of experience /relieving certificates from current and all previous employers"}]},
      {al:"both",after:12,runs:[{t:"During your stint with the company, you are duty-bound to commit your time completely to the work of the company. Moreover, you would not take up any other assignment, whether full-time, part-time or honorary, or in cash or in kind, without prior intimation and written approval from the company."}]},
      {after:12,runs:[{t:"Please return a signed copy of this letter, which would signify your acceptance."}]},
      {after:12,runs:[{t:"With Best Wishes,"}]},
      {keep:1,runs:[{t:"For ",b:1},F("COMPANY",B)]},
      {before:44,runs:[{t:"Authorized Signatory",b:1}]}
    ];
  }

  /* HTML for the A4 sheet (styles: .tr .bl .ar .f .f.empty) */
  const escH=s=>s.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
  function runHtml(r){if(r.br)return"<br>";let h=escH(r.t);
    if(r.b)h="<b>"+h+"</b>";if(r.u)h="<u>"+h+"</u>";if(r.ar)h='<span class="ar">'+h+"</span>";
    if(r.k)h='<span class="f'+(r.empty?" empty":"")+'">'+h+"</span>";return h;}
  function html(paras){
    return paras.map(p=>{
      const st=[];if(p.al)st.push("text-align:"+(p.al==="both"?"justify":p.al));if(p.after)st.push("margin-bottom:"+p.after+"pt");if(p.before)st.push("margin-top:"+p.before+"pt");
      const s=st.length?' style="'+st.join(";")+'"':"";
      if(p.tr){const i=p.runs.findIndex(r=>r.tab);return'<p class="tr"'+s+"><span>"+p.runs.slice(0,i).map(runHtml).join("")+"</span><span>"+p.runs.slice(i+1).map(runHtml).join("")+"</span></p>";}
      return"<p"+(p.bl?' class="bl"':"")+s+">"+p.runs.map(runHtml).join("")+"</p>";}).join("");}

  /* Word (.docx) parts */
  const escX=s=>s.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
  const TW=11906-1134-1021; // text width in twips (A4, 20mm left / 18mm right)
  function runXml(r){if(r.br)return"<w:r><w:br/></w:r>";if(r.tab)return"<w:r><w:tab/></w:r>";
    let pr="";if(r.ar)pr+='<w:rFonts w:ascii="Arial" w:hAnsi="Arial" w:cs="Arial"/>';if(r.b)pr+="<w:b/><w:bCs/>";if(r.u)pr+='<w:u w:val="single"/>';
    return"<w:r>"+(pr?"<w:rPr>"+pr+"</w:rPr>":"")+'<w:t xml:space="preserve">'+escX(r.t)+"</w:t></w:r>";}
  function paraXml(p){let pr=p.keep?"<w:keepNext/>":"";
    if(p.tr)pr+='<w:tabs><w:tab w:val="right" w:pos="'+TW+'"/></w:tabs>';
    if(p.bl)pr+='<w:tabs><w:tab w:val="left" w:pos="720"/></w:tabs>';
    pr+='<w:spacing w:before="'+((p.before||0)*20)+'" w:after="'+((p.after||0)*20)+'"/>';
    if(p.bl)pr+='<w:ind w:left="720" w:hanging="360"/>';
    if(p.al)pr+='<w:jc w:val="'+p.al+'"/>';
    const runs=(p.bl?[{t:"•"},{tab:1}]:[]).concat(p.runs);
    return"<w:p><w:pPr>"+pr+"</w:pPr>"+runs.map(runXml).join("")+"</w:p>";}
  function docx(paras){
    const W='xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
    return{
      "[Content_Types].xml":'<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>',
      "_rels/.rels":'<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
      "word/_rels/document.xml.rels":'<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>',
      "word/styles.xml":'<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles '+W+'><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Cambria" w:hAnsi="Cambria" w:eastAsia="Cambria" w:cs="Cambria"/><w:sz w:val="22"/><w:szCs w:val="22"/><w:lang w:val="en-IN"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="0" w:line="240" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style></w:styles>',
      "word/document.xml":'<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document '+W+'><w:body>'+paras.map(paraXml).join("")+'<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="2552" w:right="1021" w:bottom="850" w:left="1134" w:header="709" w:footer="709" w:gutter="0"/></w:sectPr></w:body></w:document>'
    };
  }
  return{LABEL,build,html,docx};
})();
