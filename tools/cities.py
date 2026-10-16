# key:(lat,lng,name,hub) ; original 12 keys kept for save compatibility
C={'SEA':(47.61,-122.33,'Seattle',1),'LA':(34.05,-118.24,'Los Angeles',1),'PHX':(33.45,-112.07,'Phoenix',1),'DEN':(39.74,-104.99,'Denver',1),
'DAL':(32.78,-96.80,'Dallas',1),'HOU':(29.76,-95.37,'Houston',1),'KC':(39.10,-94.58,'Kansas City',1),'MEM':(35.15,-90.05,'Memphis',1),
'CHI':(41.88,-87.63,'Chicago',1),'IND':(39.77,-86.16,'Indianapolis',1),'ATL':(33.75,-84.39,'Atlanta',1),'NYC':(40.71,-74.01,'New York',1),
'BHM':(33.52,-86.81,'Birmingham',0),'LIT':(34.75,-92.29,'Little Rock',0),'SFO':(37.80,-122.27,'Oakland',1),'SAC':(38.30,-121.40,'Sacramento',0),
'BDL':(41.76,-72.67,'Hartford',0),'WIL':(39.74,-75.55,'Wilmington',0),'MIA':(25.76,-80.19,'Miami',0),'JAX':(30.33,-81.66,'Jacksonville',1),
'ORL':(28.30,-81.90,'Orlando/Tampa',0),'BOI':(43.62,-116.20,'Boise',0),'DSM':(41.59,-93.62,'Des Moines',0),'ICT':(37.69,-97.34,'Wichita',0),
'LOU':(38.25,-85.76,'Louisville',1),'NOL':(29.95,-90.07,'New Orleans',0),'PWM':(43.66,-70.26,'Portland ME',0),'BAL':(39.29,-76.61,'Baltimore',0),
'BOS':(42.36,-71.06,'Boston',1),'DET':(42.33,-83.05,'Detroit',1),'MSP':(44.98,-93.27,'Minneapolis',1),'JAN':(32.30,-90.18,'Jackson',0),
'STL':(38.63,-90.20,'St. Louis',1),'BIL':(45.78,-108.50,'Billings',0),'OMA':(41.26,-95.94,'Omaha',0),'LAS':(36.17,-115.14,'Las Vegas',0),
'RNO':(39.53,-119.81,'Reno',0),'MHT':(42.99,-71.46,'Manchester',0),'NWK':(40.74,-74.17,'Newark',0),'ABQ':(35.08,-106.65,'Albuquerque',0),
'CLT':(35.23,-80.84,'Charlotte',1),'FAR':(46.88,-96.79,'Fargo',0),'CMH':(39.96,-83.00,'Columbus',1),'OKC':(35.47,-97.52,'Oklahoma City',0),
'PDX':(45.52,-122.68,'Portland',0),'PHL':(39.95,-75.17,'Philadelphia',1),'PIT':(40.44,-80.00,'Pittsburgh',0),'PVD':(41.82,-71.41,'Providence',0),
'CAE':(34.00,-81.03,'Columbia',0),'FSD':(43.55,-96.73,'Sioux Falls',0),'BNA':(36.16,-86.78,'Nashville',1),'SAT':(29.42,-98.49,'San Antonio',0),
'ELP':(31.76,-106.49,'El Paso',1),'LRD':(27.51,-99.51,'Laredo',1),'SLC':(40.76,-111.89,'Salt Lake City',1),'BTV':(44.48,-73.21,'Burlington',0),
'RIC':(37.54,-77.44,'Richmond',0),'CRW':(38.35,-81.63,'Charleston WV',0),'MKE':(43.04,-87.91,'Milwaukee',0),'CYS':(41.14,-104.82,'Cheyenne',0),
'SPK':(47.66,-117.43,'Spokane',0)}
C.update({'AUS':(30.27,-97.74,'Austin',0),'CRP':(27.80,-97.40,'Corpus Christi',0),'FTW':(32.75,-97.33,'Fort Worth',0),'LBB':(33.58,-101.86,'Lubbock',0),'AMA':(35.22,-101.83,'Amarillo',0),
'SAN':(32.72,-117.16,'San Diego',0),'SJC':(37.34,-121.89,'San Jose',0),'FAT':(36.74,-119.79,'Fresno',0),'SCK':(37.96,-121.29,'Stockton',1),'BFL':(35.37,-119.02,'Bakersfield',0),'ONT':(34.06,-117.65,'Inland Empire',1),
'TUS':(32.22,-110.97,'Tucson',0),'FLG':(35.20,-111.65,'Flagstaff',0),'TPA':(27.95,-82.46,'Tampa',0),'TLH':(30.44,-84.28,'Tallahassee',0),'PNS':(30.42,-87.22,'Pensacola',0),
'SAV':(32.08,-81.09,'Savannah',1),'MCN':(32.84,-83.63,'Macon',0),'HSV':(34.73,-86.59,'Huntsville',0),'MOB':(30.69,-88.04,'Mobile',0),'MGM':(32.38,-86.30,'Montgomery',0),
'FSM':(35.39,-94.40,'Fort Smith',0),'XNA':(36.37,-94.21,'NW Arkansas',0),'COS':(38.83,-104.82,'Colorado Springs',0),'GJT':(39.06,-108.55,'Grand Junction',0),
'STM':(41.05,-73.54,'Stamford',0),'DOV':(39.16,-75.52,'Dover',0),'IDF':(43.49,-112.03,'Idaho Falls',0),'RFD':(42.27,-89.09,'Rockford',0),'PIA':(40.69,-89.59,'Peoria',0),'SPI':(39.80,-89.64,'Springfield IL',0),
'FWA':(41.08,-85.14,'Fort Wayne',0),'EVV':(37.97,-87.57,'Evansville',0),'SBN':(41.68,-86.25,'South Bend',0),'CID':(41.98,-91.67,'Cedar Rapids',0),'DVN':(41.52,-90.58,'Quad Cities',0),
'KCK':(39.05,-95.68,'Topeka',0),'LEX':(38.04,-84.50,'Lexington',0),'BWG':(36.99,-86.44,'Bowling Green',0),'BTR':(30.45,-91.19,'Baton Rouge',0),'SHV':(32.53,-93.75,'Shreveport',0),'LFT':(30.22,-92.02,'Lafayette',0),
'BGR':(44.80,-68.77,'Bangor',0),'HGR':(39.64,-77.72,'Hagerstown',0),'WOR':(42.26,-71.80,'Worcester',0),'SPR':(42.10,-72.59,'Springfield MA',0),
'GRR':(42.96,-85.67,'Grand Rapids',0),'LAN':(42.73,-84.56,'Lansing',0),'DUL':(46.79,-92.10,'Duluth',0),'RST':(44.02,-92.47,'Rochester MN',0),
'GPT':(30.37,-89.09,'Gulfport',0),'TUP':(34.26,-88.70,'Tupelo',0),'SGF':(37.21,-93.29,'Springfield MO',0),'COU':(38.95,-92.33,'Columbia MO',0),
'MSO':(46.87,-113.99,'Missoula',0),'GTF':(47.50,-111.30,'Great Falls',0),'LNK':(40.81,-96.70,'Lincoln',0),'GRI':(40.92,-98.34,'Grand Island',0),'NPL':(41.12,-100.77,'North Platte',0),
'ELK':(40.83,-115.76,'Elko',0),'CAM':(39.93,-75.12,'Camden',0),'TTN':(40.22,-74.76,'Trenton',0),'LCR':(32.31,-106.78,'Las Cruces',0),'ROW':(33.39,-104.52,'Roswell',0),
'BUF':(42.89,-78.88,'Buffalo',1),'ALB':(42.65,-73.76,'Albany',0),'SYR':(43.05,-76.15,'Syracuse',0),'ROC':(43.16,-77.61,'Rochester NY',0),
'RDU':(35.78,-78.64,'Raleigh',0),'GSO':(36.07,-79.79,'Greensboro',0),'AVL':(35.60,-82.55,'Asheville',0),'BIS':(46.81,-100.78,'Bismarck',0),
'CLE':(41.50,-81.69,'Cleveland',1),'CVG':(39.10,-84.51,'Cincinnati',1),'TOL':(41.65,-83.54,'Toledo',0),'TUL':(36.15,-95.99,'Tulsa',0),
'EUG':(44.05,-123.09,'Eugene',0),'MFR':(42.33,-122.87,'Medford',0),'ABE':(40.60,-75.49,'Allentown',0),'HAR':(40.27,-76.88,'Harrisburg',1),'ERI':(42.13,-80.09,'Erie',0),
'GSP':(34.85,-82.39,'Greenville SC',0),'CHS':(32.78,-79.93,'Charleston SC',0),'RAP':(44.08,-103.23,'Rapid City',0),'KNX':(35.96,-83.92,'Knoxville',0),'CHA':(35.05,-85.31,'Chattanooga',0),
'OGD':(41.22,-111.97,'Ogden',0),'STG':(37.10,-113.58,'St. George',0),'RUT':(43.61,-72.97,'Rutland',0),'ORF':(36.85,-76.29,'Norfolk',1),'ROA':(37.27,-79.94,'Roanoke',0),
'TAC':(47.25,-122.44,'Tacoma',0),'YKM':(46.60,-120.51,'Yakima',0),'HTS':(38.42,-82.45,'Huntington',0),'GRB':(44.51,-88.01,'Green Bay',0),'MSN':(43.07,-89.40,'Madison',0),
'CPR':(42.87,-106.31,'Casper',0)})
import math,itertools
def gc(a,b):
  (la1,lo1),(la2,lo2)=C[a][:2],C[b][:2];p=math.pi/180
  return 3959*2*math.asin(math.sqrt(math.sin((la2-la1)*p/2)**2+math.cos(la1*p)*math.cos(la2*p)*math.sin((lo2-lo1)*p/2)**2))
CORR=[('LA','CHI'),('LA','DAL'),('LA','ATL'),('SEA','CHI'),('SEA','MSP'),('SFO','DEN'),('DAL','ATL'),('HOU','ATL'),('CHI','ATL'),('CHI','NYC'),
('DAL','CHI'),('LRD','CHI'),('LRD','ATL'),('ELP','DAL'),('PHX','DAL'),('ATL','NYC'),('MIA','NYC'),('JAX','CHI'),('DEN','CHI'),('SLC','CHI'),('DAL','NYC'),('LA','HOU'),('SEA','SLC'),('MEM','NYC'),('BOS','CHI'),('SAN','DAL'),('LA','ELP'),('SFO','SLC'),('SEA','DEN'),('PDX','SLC'),('LRD','DAL'),('LRD','MEM'),('HOU','JAX'),('HOU','CHI'),('ATL','MIA'),('CHI','CLT'),('DEN','DAL'),('PHX','DEN'),('KC','DEN'),('MSP','CHI'),('ONT','PHX'),('SCK','PDX'),('ATL','PHL'),('BOS','NYC')]
def pairs(K=4,R=230):
  s=set()
  for a in C:
    for b in sorted([x for x in C if x!=a],key=lambda x:gc(a,x))[:K]:s.add(tuple(sorted((a,b))))
  for a,b in itertools.combinations(C,2):
    if gc(a,b)<R:s.add(tuple(sorted((a,b))))
  for a,b in CORR:s.add(tuple(sorted((a,b))))
  return sorted(s)
if __name__=='__main__':print(len(C),len(pairs()))
