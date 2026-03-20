// Outlet collection GIDs mapped to their display names
export const OUTLET_COLLECTIONS = {
  "gid://shopify/Collection/685232357710": "Outlet skivor",
  "gid://shopify/Collection/685232390478": "Outlet byggmaterial",
  "gid://shopify/Collection/685232456014": "Outlet trävaror",
  "gid://shopify/Collection/685232619854": "Outlet interiör",
  "gid://shopify/Collection/685232652622": "Outlet kakel & klinker"
};

/*export const OUTLET_COLLECTIONS = {
  "gid://shopify/Collection/304431300656": "Outlet skivor",
  "gid://shopify/Collection/304431333424": "Outlet byggmaterial",
  "gid://shopify/Collection/304431366192": "Outlet trävaror",
  "gid://shopify/Collection/304431431728": "Outlet interiör",
  "gid://shopify/Collection/304431464496": "Outlet kakel & klinker"
};*/


// Mapping of Monitor PartCodeId to outlet collection GID
// Based on part code ranges: 1xxx=skivor, 2xxx=byggmaterial, 3xxx=trävaror, 4xxx=interiör (excl 46xx), 46xx=kakel & klinker
// 9xxx codes (services, marketing, packaging) are excluded
export const PART_CODE_TO_OUTLET_COLLECTION = {
  // 1xxx - Outlet skivor
  "998744361981740489": "gid://shopify/Collection/304431300656", // 1101 Board
  "998744361981740491": "gid://shopify/Collection/304431300656", // 1102 Softboard
  "998744361981740493": "gid://shopify/Collection/304431300656", // 1103 Asfaltboard
  "998744361981740495": "gid://shopify/Collection/304431300656", // 1111 Hdf
  "998744361981740529": "gid://shopify/Collection/304431300656", // 1113 Lackerad Hdf
  "998744361981740531": "gid://shopify/Collection/304431300656", // 1114 Fuktresistent Hdf
  "998744361981740533": "gid://shopify/Collection/304431300656", // 1121 Mdf
  "998744361981740535": "gid://shopify/Collection/304431300656", // 1122 Fuktresistent Mdf
  "998744361981740537": "gid://shopify/Collection/304431300656", // 1123 Brandklassad Mdf
  "998744361981740539": "gid://shopify/Collection/304431300656", // 1124 Genomfärgad Mdf
  "1058494584519258320": "gid://shopify/Collection/304431300656", // 1125 Tjock mdf
  "998744361981740541": "gid://shopify/Collection/304431300656", // 1131 Fanerad Mdf
  "998744361981740543": "gid://shopify/Collection/304431300656", // 1132 Melaminbelagd Mdf
  "998744361981740513": "gid://shopify/Collection/304431300656", // 1135 Laminerad Mdf
  "998744361981740515": "gid://shopify/Collection/304431300656", // 1199 Board & Mdf övrigt
  "998744361981740517": "gid://shopify/Collection/304431300656", // 1201 Björkplywood
  "998744361981740519": "gid://shopify/Collection/304431300656", // 1211 Furuplywood
  "998744361981740521": "gid://shopify/Collection/304431300656", // 1212 Poppelplywood
  "998744361981740523": "gid://shopify/Collection/304431300656", // 1221 Fanerad Plywood
  "998744361981740525": "gid://shopify/Collection/304431300656", // 1222 Profilerad Plywood
  "998744361981740527": "gid://shopify/Collection/304431300656", // 1223 Flexible Plywood
  "998744361981740049": "gid://shopify/Collection/304431300656", // 1224 Ädelträ Plywood
  "998744361981740051": "gid://shopify/Collection/304431300656", // 1231 Formplywood
  "998744361981740053": "gid://shopify/Collection/304431300656", // 1232 Filmbelagd Björkplywood
  "998744361981740055": "gid://shopify/Collection/304431300656", // 1233 Slitskyddsplywood
  "998744361981740057": "gid://shopify/Collection/304431300656", // 1234 Lanbruks/färgad Plywood
  "998744361981740059": "gid://shopify/Collection/304431300656", // 1236 Laminerad Plywood
  "998744361981740061": "gid://shopify/Collection/304431300656", // 1241 Byggplywood
  "998744361981740063": "gid://shopify/Collection/304431300656", // 1242 Emballageplywood
  "998744361981740033": "gid://shopify/Collection/304431300656", // 1243 Konstruktionsplywood
  "998744361981740035": "gid://shopify/Collection/304431300656", // 1299 Plywood övrigt
  "998744361981740037": "gid://shopify/Collection/304431300656", // 1301 OSB Skivor
  "998744361981740039": "gid://shopify/Collection/304431300656", // 1401 Fanerlamell
  "998744361981740041": "gid://shopify/Collection/304431300656", // 1402 Spånlamell
  "998744361981740043": "gid://shopify/Collection/304431300656", // 1403 HDF-lamell
  "998744361981740045": "gid://shopify/Collection/304431300656", // 1404 MF-lamell
  "998744361981740047": "gid://shopify/Collection/304431300656", // 1411 Limfog Hobbyskivor
  "998744361981740081": "gid://shopify/Collection/304431300656", // 1412 Limfog Bänkskivor
  "998744361981740083": "gid://shopify/Collection/304431300656", // 1421 Limfog Snickeriskivor fingerskarv
  "998744361981740085": "gid://shopify/Collection/304431300656", // 1431 Limfog Snickeriskivor Helstav
  "998744361981740087": "gid://shopify/Collection/304431300656", // 1441 Limfog Trappämnen
  "998744361981740089": "gid://shopify/Collection/304431300656", // 1499 Lamellskivor & Limfog övrigt
  "998744361981740091": "gid://shopify/Collection/304431300656", // 1501 Spånskivor
  "998744361981740093": "gid://shopify/Collection/304431300656", // 1503 Fuktresistent Spånskiva
  "998744361981740095": "gid://shopify/Collection/304431300656", // 1504 Branklassad Spånskiva
  "998744361981740065": "gid://shopify/Collection/304431300656", // 1511 Golvspån
  "998744361981740067": "gid://shopify/Collection/304431300656", // 1521 Melaminbelagd Spånskiva
  "998744361981740069": "gid://shopify/Collection/304431300656", // 1522 Hyllplan
  "998744361981740071": "gid://shopify/Collection/304431300656", // 1523 Fanerad Spånskiva
  "998744361981740073": "gid://shopify/Collection/304431300656", // 1525 Laminerad Spånskiva
  "998744361981740075": "gid://shopify/Collection/304431300656", // 1599 Spånskivor övrigt
  "998744361981740077": "gid://shopify/Collection/304431300656", // 1601 Gipsskivor
  "998744361981740079": "gid://shopify/Collection/304431300656", // 1610 Fibergips
  "998744361981740113": "gid://shopify/Collection/304431300656", // 1611 Fibercement
  "998744361981740115": "gid://shopify/Collection/304431300656", // 1612 Spåncement
  "1066066848136982158": "gid://shopify/Collection/304431300656", // 1615 Magnaboard
  "998744361981740117": "gid://shopify/Collection/304431300656", // 1620 Pvc Skivor
  "998744361981740119": "gid://shopify/Collection/304431300656", // 1621 Kompositskivor
  "998744361981740121": "gid://shopify/Collection/304431300656", // 1625 Plastlaminat
  "998744361981740123": "gid://shopify/Collection/304431300656", // 1630 Laminat
  "998744361981740125": "gid://shopify/Collection/304431300656", // 1631 Kompaktlaminat
  "998744361981740127": "gid://shopify/Collection/304431300656", // 1640 Kantlist laminat
  "998744361981740097": "gid://shopify/Collection/304431300656", // 1641 Kantlist ABS
  "998744361981740099": "gid://shopify/Collection/304431300656", // 1645 Kantlist Faner
  "998744361981740101": "gid://shopify/Collection/304431300656", // 1650 Faner
  "998744361981740103": "gid://shopify/Collection/304431300656", // 1651 Fogat faner
  "998744361981740105": "gid://shopify/Collection/304431300656", // 1690 Oorganiska skivor tillbehör
  "998744361981740107": "gid://shopify/Collection/304431300656", // 1691 Ytbeläggningar tillbehör
  "998744361981740109": "gid://shopify/Collection/304431300656", // 1699 Oorganiska skivor & ytbeläggningar
  "998744361981740111": "gid://shopify/Collection/304431300656", // 1999 Skivmaterial övrigt

  // 2xxx - Outlet byggmaterial
  "998744361981740145": "gid://shopify/Collection/304431333424", // 2120 Takprodukter
  "998744361981740147": "gid://shopify/Collection/304431333424", // 2130 Markläggning
  "998744361981740149": "gid://shopify/Collection/304431333424", // 2201 Mineralull
  "998744361981740151": "gid://shopify/Collection/304431333424", // 2202 Cellplast
  "998744361981740153": "gid://shopify/Collection/304431333424", // 2205 Träull
  "998744361981740155": "gid://shopify/Collection/304431333424", // 2207 Skumplast
  "998744361981740157": "gid://shopify/Collection/304431333424", // 2210 Kantelement
  "998744361981740159": "gid://shopify/Collection/304431333424", // 2215 Cellulosaisolering
  "998744361981740129": "gid://shopify/Collection/304431333424", // 2299 Isoleringsmaterial övrigt
  "998744361981740131": "gid://shopify/Collection/304431333424", // 2301 Underlagspapp
  "998744361981740133": "gid://shopify/Collection/304431333424", // 2302 Ytpapp
  "998744361981740135": "gid://shopify/Collection/304431333424", // 2309 Papprodukter övrigt
  "998744361981740137": "gid://shopify/Collection/304431333424", // 2310 Gummiduk
  "998744361981740139": "gid://shopify/Collection/304431333424", // 2311 Fogband
  "998744361981740141": "gid://shopify/Collection/304431333424", // 2315 Plastfolie
  "998744361981740143": "gid://shopify/Collection/304431333424", // 2320 Tejp
  "998744361981740177": "gid://shopify/Collection/304431333424", // 2325 Tätningslist
  "998744361981740179": "gid://shopify/Collection/304431333424", // 2330 Tätskiktssystem
  "998744361981740181": "gid://shopify/Collection/304431333424", // 2399 Tätning övrigt
  "998744361981740183": "gid://shopify/Collection/304431333424", // 2411 Tunnplåtsprofiler
  "998744361981740185": "gid://shopify/Collection/304431333424", // 2412 Armeringsnät
  "998744361981740187": "gid://shopify/Collection/304431333424", // 2501 Betongtillsatsmedel
  "998744361981740189": "gid://shopify/Collection/304431333424", // 2502 Lim
  "998744361981740191": "gid://shopify/Collection/304431333424", // 2503 Fäst och Fogmassa
  "998744361981740161": "gid://shopify/Collection/304431333424", // 2504 Asfalts- och tätmassor
  "998744361981740163": "gid://shopify/Collection/304431333424", // 2505 Kitt och spackel
  "998744361981740165": "gid://shopify/Collection/304431333424", // 2506 Oljor och fett
  "1113038690552645442": "gid://shopify/Collection/304431333424", // 2509 Fäst och fogmassa tillbehör
  "1113039069583715935": "gid://shopify/Collection/304431333424", // 2510 Avjämning
  "1113039173736640788": "gid://shopify/Collection/304431333424", // 2511 Avjämning tillbehör
  "998744361981740167": "gid://shopify/Collection/304431333424", // 2518 Poolkemikalier
  "998744361981740169": "gid://shopify/Collection/304431333424", // 2520 Såpa
  "998744361981740171": "gid://shopify/Collection/304431333424", // 2599 Kemisk tekniska varor övrigt
  "998744361981740173": "gid://shopify/Collection/304431333424", // 2999 Byggmaterial övrigt

  // 3xxx - Outlet trävaror
  "998744361981740175": "gid://shopify/Collection/304431366192", // 3101 Ask okantad
  "998744361981740209": "gid://shopify/Collection/304431366192", // 3102 Ask kantad
  "1058496860851955356": "gid://shopify/Collection/304431366192", // 3105 Ask Thermobehandlad
  "998744361981740211": "gid://shopify/Collection/304431366192", // 3110 Björk okantad
  "998744361981740213": "gid://shopify/Collection/304431366192", // 3111 Björk kantad
  "998744361981740215": "gid://shopify/Collection/304431366192", // 3120 Bok okantad
  "998744361981740217": "gid://shopify/Collection/304431366192", // 3121 Bok kantad
  "998744361981740223": "gid://shopify/Collection/304431366192", // 3130 Europeisk Ek okantad
  "998744361981740221": "gid://shopify/Collection/304431366192", // 3131 Europeisk Ek kantad
  "998744361981740219": "gid://shopify/Collection/304431366192", // 3132 Amerikansk Vitek
  "998744361981740195": "gid://shopify/Collection/304431366192", // 3133 Rödek
  "998744361981740193": "gid://shopify/Collection/304431366192", // 3139 Ek övrigt
  "998744361981740197": "gid://shopify/Collection/304431366192", // 3140 Furu osorterad
  "998744361981740199": "gid://shopify/Collection/304431366192", // 3141 Furu sidobrädor
  "998744361981740201": "gid://shopify/Collection/304431366192", // 3142 Furu scantling
  "998744361981740203": "gid://shopify/Collection/304431366192", // 3143 Furu stamvara
  "1058496960709944986": "gid://shopify/Collection/304431366192", // 3145 Furu Thermobehandlad
  "998744361981740205": "gid://shopify/Collection/304431366192", // 3147 Gran sågad
  "998744361981740207": "gid://shopify/Collection/304431366192", // 3148 Gran hyvlad
  "998744361981740241": "gid://shopify/Collection/304431366192", // 3150 Al
  "998744361981740243": "gid://shopify/Collection/304431366192", // 3151 Alm
  "998744361981740245": "gid://shopify/Collection/304431366192", // 3152 Asp
  "998744361981740247": "gid://shopify/Collection/304431366192", // 3155 Ceder
  "998744361981740249": "gid://shopify/Collection/304431366192", // 3156 Gaboon
  "998744361981740251": "gid://shopify/Collection/304431366192", // 3158 Iroko
  "998744361981740253": "gid://shopify/Collection/304431366192", // 3160 Körsbär
  "998744361981740255": "gid://shopify/Collection/304431366192", // 3162 Lind
  "998744361981740225": "gid://shopify/Collection/304431366192", // 3163 Lönn
  "998744361981740227": "gid://shopify/Collection/304431366192", // 3165 Mahogny
  "998744361981740229": "gid://shopify/Collection/304431366192", // 3166 Merbau
  "998744361981740231": "gid://shopify/Collection/304431366192", // 3167 Oregon Pine
  "998744361981740233": "gid://shopify/Collection/304431366192", // 3168 Poppel
  "998744361981740235": "gid://shopify/Collection/304431366192", // 3170 Sibirisk Lärk okantad
  "998744361981740237": "gid://shopify/Collection/304431366192", // 3171 Sibirisk Lärk kantad
  "1094562653826506315": "gid://shopify/Collection/304431366192", // 3172 Kanadensisk Lärk okantad
  "1094562853542464583": "gid://shopify/Collection/304431366192", // 3173 Kanadensisk Lärk kantad
  "998744361981740239": "gid://shopify/Collection/304431366192", // 3177 Teak
  "998744361981740273": "gid://shopify/Collection/304431366192", // 3178 Valnöt
  "998744361981740275": "gid://shopify/Collection/304431366192", // 3179 Wenge
  "998744361981740277": "gid://shopify/Collection/304431366192", // 3199 Ädelträ övrigt
  "998744361981740279": "gid://shopify/Collection/304431366192", // 3201 Askämne
  "998744361981740281": "gid://shopify/Collection/304431366192", // 3202 Askämne brunkärna
  "998744361981740283": "gid://shopify/Collection/304431366192", // 3203 Askämne kapat
  "998744361981740287": "gid://shopify/Collection/304431366192", // 3210 Björkämne
  "998744361981740257": "gid://shopify/Collection/304431366192", // 3211 Björkämne 2:a sort
  "998744361981740259": "gid://shopify/Collection/304431366192", // 3220 Bokämne
  "998744361981740261": "gid://shopify/Collection/304431366192", // 3230 Ekämne
  "998744361981740263": "gid://shopify/Collection/304431366192", // 3231 Ekämne 2:a sort
  "998744361981740265": "gid://shopify/Collection/304431366192", // 3232 Ekämne Amerikanskt
  "998744361981740267": "gid://shopify/Collection/304431366192", // 3233 Ekämne Kapat
  "998744361981740285": "gid://shopify/Collection/304431366192", // 3250 Alämne
  "998744361981740269": "gid://shopify/Collection/304431366192", // 3260 Körsbärsämne
  "998744361981740271": "gid://shopify/Collection/304431366192", // 3261 Körsbärsämne 2:a sort
  "998744361981739793": "gid://shopify/Collection/304431366192", // 3299 Ämnen övrigt
  "998744361981739795": "gid://shopify/Collection/304431366192", // 3301 Sibirisk Lärk Trall
  "998744361981739797": "gid://shopify/Collection/304431366192", // 3302 Sibirisk Lärk Regel
  "998744361981739799": "gid://shopify/Collection/304431366192", // 3303 Sibirisk Lärk Panel
  "998744361981739801": "gid://shopify/Collection/304431366192", // 3304 Sibirisk Lärk Övriga profiler
  "1094562969506630450": "gid://shopify/Collection/304431366192", // 3306 Kärnfuru Trall
  "998744361981739803": "gid://shopify/Collection/304431366192", // 3310 Thermo Furu Trall
  "998744361981739805": "gid://shopify/Collection/304431366192", // 3311 Thermo Furu Regel
  "998744361981739807": "gid://shopify/Collection/304431366192", // 3312 Thermo Furu Panel
  "998744361981739777": "gid://shopify/Collection/304431366192", // 3313 Thermo Furu Övriga profiler
  "1058497335445842814": "gid://shopify/Collection/304431366192", // 3317 Thermo Gran Panel
  "1190261949622277225": "gid://shopify/Collection/304431366192", // 3319 Thermo Gran övriga profiler
  "998744361981739779": "gid://shopify/Collection/304431366192", // 3320 Thermo Ask Trall
  "998744361981739781": "gid://shopify/Collection/304431366192", // 3325 Thermo Royal Trall
  "998744361981739783": "gid://shopify/Collection/304431366192", // 3327 Exotisk Trall
  "998744361981739785": "gid://shopify/Collection/304431366192", // 3330 Komposit Trall
  "998744361981739787": "gid://shopify/Collection/304431366192", // 3390 Utemiljö tillbehör
  "998744361981739789": "gid://shopify/Collection/304431366192", // 3399 Utemiljö övrigt
  "998744361981739791": "gid://shopify/Collection/304431366192", // 3401 Limträbalk
  "998744361981739825": "gid://shopify/Collection/304431366192", // 3402 Limträpelare
  "998744361981739827": "gid://shopify/Collection/304431366192", // 3403 Limträbalk tryckimpregnerad
  "998744361981739829": "gid://shopify/Collection/304431366192", // 3410 Lättregel
  "998744361981739831": "gid://shopify/Collection/304431366192", // 3411 Lättbalk
  "998744361981739833": "gid://shopify/Collection/304431366192", // 3420 LVL
  "998744361981739835": "gid://shopify/Collection/304431366192", // 3499 Balk Övrigt
  "998744361981739837": "gid://shopify/Collection/304431366192", // 3501 Sågat virke
  "998744361981739839": "gid://shopify/Collection/304431366192", // 3502 Sparrar
  "998744361981739809": "gid://shopify/Collection/304431366192", // 3503 Dimensionshyvlat virke
  "998744361981739811": "gid://shopify/Collection/304431366192", // 3504 Underlagsspont
  "998744361981739813": "gid://shopify/Collection/304431366192", // 3506 Slätspont
  "998744361981739815": "gid://shopify/Collection/304431366192", // 3507 Läkt
  "998744361981739817": "gid://shopify/Collection/304431366192", // 3508 Formvirke
  "998744361981739819": "gid://shopify/Collection/304431366192", // 3510 Hållfasthetssorterat virke
  "998744361981739821": "gid://shopify/Collection/304431366192", // 3520 Utvändigt beklädnadsvirke
  "998744361981739823": "gid://shopify/Collection/304431366192", // 3530 Tryckimpregnerat virke
  "998744361981739857": "gid://shopify/Collection/304431366192", // 3541 Värmebehandlat virke - sågat
  "998744361981739859": "gid://shopify/Collection/304431366192", // 3999 Trävaror övrigt

  // 4xxx - Outlet interiör (excl. 46xx)
  "998744361981739861": "gid://shopify/Collection/304431431728", // 4110 Planhyvlat Trä
  "998744361981739863": "gid://shopify/Collection/304431431728", // 4115 Trälist obehandlad
  "998744361981739865": "gid://shopify/Collection/304431431728", // 4120 Trälist behandlad
  "998744361981739867": "gid://shopify/Collection/304431431728", // 4125 Mdflist
  "1066073233679606439": "gid://shopify/Collection/304431431728", // 4129 Övrig list
  "998744361981739869": "gid://shopify/Collection/304431431728", // 4130 Interiörpanel
  "998744361981739871": "gid://shopify/Collection/304431431728", // 4135 Bastupanel
  "998744361981739841": "gid://shopify/Collection/304431431728", // 4140 FIBO Panel
  "998744361981739843": "gid://shopify/Collection/304431431728", // 4141 FIBO Tillbehör
  "998744361981739845": "gid://shopify/Collection/304431431728", // 4150 Takpanel
  "998744361981739847": "gid://shopify/Collection/304431431728", // 4199 List & Panel övrigt
  "998744361981739849": "gid://shopify/Collection/304431431728", // 4201 Massiva trägolv - Furu & Gran
  "998744361981739851": "gid://shopify/Collection/304431431728", // 4202 Parkettgolv
  "998744361981739853": "gid://shopify/Collection/304431431728", // 4203 Laminatgolv
  "998744361981739855": "gid://shopify/Collection/304431431728", // 4204 Plastgolv
  "998744361981739889": "gid://shopify/Collection/304431431728", // 4205 Linoleumgolv
  "998744361981739891": "gid://shopify/Collection/304431431728", // 4206 Textilgolv
  "998744361981739893": "gid://shopify/Collection/304431431728", // 4207 Golvmaterial övrigt
  "998744361981739895": "gid://shopify/Collection/304431431728", // 4210 Massiva trägolv - Ädelträ
  "998744361981739897": "gid://shopify/Collection/304431431728", // 4211 Gummigolv
  "998744361981739899": "gid://shopify/Collection/304431431728", // 4212 Fanérgolv
  "1147216148191365492": "gid://shopify/Collection/304431431728", // 4225 Stegljudsisolering
  "1147216234090698959": "gid://shopify/Collection/304431431728", // 4230 Golvvärme
  "998744361981739901": "gid://shopify/Collection/304431431728", // 4299 Golvvaror övrigt
  "998744361981739903": "gid://shopify/Collection/304431431728", // 4310 Fönster och tillbehör
  "998744361981739873": "gid://shopify/Collection/304431431728", // 4315 Fönstersmygar
  "1147216278114107517": "gid://shopify/Collection/304431431728", // 4316 Fönsterbänkar
  "1067877468551669756": "gid://shopify/Collection/304431431728", // 4319 -
  "998744361981739875": "gid://shopify/Collection/304431431728", // 4320 Dörrar och tillbehör
  "998744361981739877": "gid://shopify/Collection/304431431728", // 4325 Karmar
  "998744361981739879": "gid://shopify/Collection/304431431728", // 4326 Dörromfattning
  "998744361981739881": "gid://shopify/Collection/304431431728", // 4330 Garageportar och tillbehör
  "1147216328579976392": "gid://shopify/Collection/304431431728", // 4401 Badrumssnickerier
  "1147216460650544086": "gid://shopify/Collection/304431431728", // 4402 Badrumstillbehör
  "1147216530443755021": "gid://shopify/Collection/304431431728", // 4404 Duschkabiner och duschväggar
  "1147216624933054864": "gid://shopify/Collection/304431431728", // 4406 Sanitetsporslin
  "1147216736602253326": "gid://shopify/Collection/304431431728", // 4407 Sanitet tillbehör
  "1147216779551916330": "gid://shopify/Collection/304431431728", // 4408 Sanitet övrigt
  "1147216816059141062": "gid://shopify/Collection/304431431728", // 4409 Badrumsinredning övrigt
  "998744361981739883": "gid://shopify/Collection/304431431728", // 4410 Trappor
  "998744361981739885": "gid://shopify/Collection/304431431728", // 4420 Spaljéer
  "998744361981739887": "gid://shopify/Collection/304431431728", // 4430 Skåp
  "998744361981739921": "gid://shopify/Collection/304431431728", // 4440 Insektsnät
  "998744361981739923": "gid://shopify/Collection/304431431728", // 4510 Spik
  "998744361981739925": "gid://shopify/Collection/304431431728", // 4520 Skruv
  "998744361981739927": "gid://shopify/Collection/304431431728", // 4530 Infästning och expander

  // 46xx - Outlet kakel & klinker
  "1110138870900252268": "gid://shopify/Collection/304431464496", // 4601 Kakel
  "1110138954652117376": "gid://shopify/Collection/304431464496", // 4602 Kakel vit bas
  "1110139039477697825": "gid://shopify/Collection/304431464496", // 4605 Klinker
  "1110139243488638725": "gid://shopify/Collection/304431464496", // 4606 Klinker ute
  "1110139363747694482": "gid://shopify/Collection/304431464496", // 4607 Klinker bas
  "1110139475416963195": "gid://shopify/Collection/304431464496", // 4608 Mosaik
  "1110139539841478696": "gid://shopify/Collection/304431464496", // 4609 Natursten
  "1110139752442358784": "gid://shopify/Collection/304431464496", // 4619 Kakel och klinker tillbehör
  "1110140308640420751": "gid://shopify/Collection/304431464496", // 4620 Bänkskivor sten

  // 4xxx - Outlet interiör (cont.)
  "1232881747615246810": "gid://shopify/Collection/304431431728", // 4710 Sisalmattor
  "1232881769090088728": "gid://shopify/Collection/304431431728", // 4711 Sisal/Ullmattor
  "1232881771237570899": "gid://shopify/Collection/304431431728", // 4712 Cocos/Sisalmattor
  "1232881773385054553": "gid://shopify/Collection/304431431728", // 4713 Cocosborstmattor
  "1232881776606280055": "gid://shopify/Collection/304431431728", // 4714 Ullmattor
  "1232881779827505383": "gid://shopify/Collection/304431431728", // 4715 Syntetsmattor
  "1232881781974989033": "gid://shopify/Collection/304431431728", // 4716 Sjögräsmattor
  "1232881785196214509": "gid://shopify/Collection/304431431728", // 4717 Gångmattor
  "1232881787343698161": "gid://shopify/Collection/304431431728", // 4750 Bandkant & Langett
  "1281142481819118099": "gid://shopify/Collection/304431431728", // 4790 Mattor - Övriga tillbehör
  "998744361981739929": "gid://shopify/Collection/304431431728", // 4999 Inredning & Snickeri övrigt
};
