library(readxl)
library(ggplot2)
library(ggpubr)

###readxls###
library(readxl)
Furong_whole_rock <- read_excel("G:/R-ggplot2/Furong whole rock.xls", sheet = "Sheet2", range = "A1:BC25")
View(Furong_whole_rock)

###ggplot###
p1 <- ggplot(data = Furong_whole_rock, aes(x = SiO2, y=Al2O3, shape = Type, colour = Type)) +
  geom_point(size = 4) + 
  geom_smooth(method = lm)+ 
  ##geom_text(aes(label=Sample),size = 4, check_overlap = TRUE,nudge_x = 2,nudge_y = 2) +
  labs(###title = "Furong granite",
       ###subtitle = "Major oxide vs. SiO2",
       x = "SiO2(%)",
       y = "Al2O3(%)",
       colour = "Type",
       caption = "By CKD")
p2 <- p1 + theme(legend.position = c(0.8,0.8)) 

show(p2)

###various plot combanation ###
p3 <- ggplot(data = Furong_whole_rock, aes(x = SiO2, y= CaO, shape = Type, colour = Type)) +
  geom_point(size = 4) + 
  geom_smooth(method = lm) + 
  ##geom_text(aes(label=Sample),size = 4, check_overlap = TRUE,nudge_x = 2,nudge_y = 2) +
  labs(###title = "Furong granite",
       ###subtitle = "Major oxide vs. SiO2",
       x = "SiO2(%)",
       y = "CaO(%)",
       colour = "Type",
       caption = "By CKD")
p4 <- p3 + theme(legend.position = c(0.8,0.8)) 

show(p4)

###TiO2###
p5 <- ggplot(data = Furong_whole_rock, aes(x = SiO2, y = TiO2, shape = Type, colour = Type)) +
  geom_point(size = 4) + 
  geom_smooth(method = lm) + 
  labs(x = "SiO2(%)",
    y = "TiO2(%)",
    colour = "Type",
    caption = "By CKD")
p6 <- p5 + theme(legend.position = c(0.8,0.8))

show(p6)

###MgO###
p7 <- ggplot(data = Furong_whole_rock, aes(x = SiO2, y= MgO, shape = Type, colour = Type)) +
  geom_point(size = 4) + 
  geom_smooth(method = lm) + 
  ##geom_text(aes(label=Sample),size = 4, check_overlap = TRUE,nudge_x = 2,nudge_y = 2) +
  labs(###title = "Furong granite",
    ###subtitle = "Major oxide vs. SiO2",
    x = "SiO2(%)",
    y = "MgO(%)",
    colour = "Type",
    caption = "By CKD")
p8 <- p7 + theme(legend.position = c(0.8,0.8))

show(p8)

ggarrange(p2,p4,p6,p8,ncol = 2,nrow = 2, labels = c("A","B","C","D"))


###trace element spider plot###

